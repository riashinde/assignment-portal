/*
  Assignment Portal — frontend script.

  USE_MOCK
  While this is true, api() answers from the sample data below.
  False means the portal uses Firebase Auth, Firestore, and Storage.
  This project is on the Spark plan, so the pages talk to Firestore
  directly. There is no Cloud Run server in this folder.

  A new account needs an email, a password, and a Student or Teacher
  choice. The portal saves that role in Firestore at users/{uid}.

  firebaseConfig
  Real web config for the CloudComputing Firebase project.
*/

const USE_MOCK = false;

const firebaseConfig = {
  apiKey: "AIzaSyA-EkP9doLAlO8syZtoBg7Q7BIHEq-YMKQ",
  authDomain: "cloudcomputing-db6ca.firebaseapp.com",
  projectId: "cloudcomputing-db6ca",
  storageBucket: "cloudcomputing-db6ca.firebasestorage.app",
  messagingSenderId: "263232994713",
  appId: "1:263232994713:web:4004e1386fd93d9e5a2708",
  measurementId: "G-0656B897WW"
};

// Filled in by the login step. The real API expects this on every request.
let idToken = null;

// Who is signed in while USE_MOCK is true. Null until the login step.
let mockSession = null;

/*
  Sample accounts. These exist only in the browser while USE_MOCK is true.
  They are not real Firebase users.
*/
const mockUsers = [
  {
    uid: "student-1",
    email: "student@school.edu",
    password: "student123",
    role: "student"
  },
  {
    uid: "teacher-1",
    email: "teacher@school.edu",
    password: "teacher123",
    role: "teacher"
  }
];

/*
  Two assignments so later pages have something to show.
  Lab report 1 is still open. Week 2 quiz is already past its deadline
  (today in this project is after 1 Oct 2026), which lets us test a late upload.
*/
let mockAssignments = [
  {
    id: "a1",
    title: "Lab report 1",
    description: "Write up the cloud storage lab. PDF or DOCX is fine.",
    deadline: "2026-11-15T23:59:00.000Z"
  },
  {
    id: "a2",
    title: "Week 2 quiz files",
    description: "Upload your answers as a ZIP file.",
    deadline: "2026-10-01T23:59:00.000Z"
  }
];

/*
  One submission from someone else, so a teacher has a row to look at.
  student@school.edu has not submitted yet.
*/
let mockSubmissions = [
  {
    id: "s1",
    assignmentId: "a1",
    studentEmail: "alex@school.edu",
    fileName: "lab-report.pdf",
    submittedAt: "2026-10-12T14:05:00.000Z",
    status: "submitted"
  }
];

const MAX_FILE_BYTES = 10 * 1024 * 1024;

/*
  api(path, options)

  Every page will call this instead of talking to the server directly.
  Success returns the JSON body (an object or a list).
  Failure throws an Error. err.message is the text from { error: "..." },
  which is the same shape the real API uses.

  Try it in the browser console on index.html:

    await api("/api/assignments")
    api("/api/not-a-real-path").catch(function (err) { console.log(err.message); })

  The first line prints the sample assignments.
  The second prints: Unknown request.
*/
async function api(path, options) {
  const settings = options || {};
  const method = (settings.method || "GET").toUpperCase();

  if (USE_MOCK) {
    const result = mockRequest(method, path, settings);
    if (result.error) {
      throw requestError(result.status, result.error);
    }
    return result.data;
  }

  return firebaseRequest(method, path, settings);
}

// The pages can show err.message. status is 400 or 403, matching the API.
function requestError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/*
  Pretends to be the backend. Same paths the real server will use.
  Returns { data } or { error, status }. api() turns an error into a throw.
*/
function mockRequest(method, path, settings) {
  if (method === "GET" && path === "/api/me") {
    if (!mockSession) {
      return fail(403, "Please log in first.");
    }
    return {
      data: {
        uid: mockSession.uid,
        email: mockSession.email,
        role: mockSession.role
      }
    };
  }

  if (method === "GET" && path === "/api/assignments") {
    return { data: mockAssignments.map(copyItem) };
  }

  if (method === "POST" && path === "/api/assignments") {
    if (!mockSession) {
      return fail(403, "Please log in first.");
    }
    if (mockSession.role !== "teacher") {
      return fail(403, "Only a teacher can create an assignment.");
    }
    const body = settings.body || {};
    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();
    const deadline = body.deadline;
    if (!title || !description || !deadline) {
      return fail(400, "Title, description, and deadline are required.");
    }
    if (Number.isNaN(Date.parse(deadline))) {
      return fail(400, "Deadline must be a valid date.");
    }
    const created = {
      id: "a" + Date.now(),
      title: title,
      description: description,
      deadline: new Date(deadline).toISOString()
    };
    mockAssignments.push(created);
    return { data: copyItem(created) };
  }

  const submissionPath = path.match(/^\/api\/assignments\/([^/]+)\/submissions$/);

  if (method === "POST" && submissionPath) {
    if (!mockSession) {
      return fail(403, "Please log in first.");
    }
    if (mockSession.role !== "student") {
      return fail(403, "Only a student can submit a file.");
    }
    const assignment = findAssignment(submissionPath[1]);
    if (!assignment) {
      return fail(400, "That assignment does not exist.");
    }
    if (Date.parse(assignment.deadline) < Date.now()) {
      return fail(400, "The deadline has passed.");
    }
    const file = settings.file;
    if (!file) {
      return fail(400, "Choose a file to upload.");
    }
    const fileName = String(file.name || "");
    if (!/\.(pdf|docx|zip)$/i.test(fileName)) {
      return fail(400, "Only PDF, DOCX, or ZIP files are allowed.");
    }
    if (file.size > MAX_FILE_BYTES) {
      return fail(400, "File must be 10 MB or smaller.");
    }
    const saved = {
      id: "s" + Date.now(),
      assignmentId: assignment.id,
      studentEmail: mockSession.email,
      fileName: fileName,
      submittedAt: new Date().toISOString(),
      status: "submitted"
    };
    mockSubmissions.push(saved);
    return { data: { id: saved.id, status: "submitted" } };
  }

  if (method === "GET" && path === "/api/my-submissions") {
    if (!mockSession) {
      return fail(403, "Please log in first.");
    }
    const mine = mockSubmissions.filter(function (item) {
      return item.studentEmail === mockSession.email;
    });
    return {
      data: mine.map(function (item) {
        return {
          id: item.id,
          assignmentId: item.assignmentId,
          fileName: item.fileName,
          submittedAt: item.submittedAt,
          status: item.status
        };
      })
    };
  }

  if (method === "GET" && submissionPath) {
    if (!mockSession) {
      return fail(403, "Please log in first.");
    }
    if (mockSession.role !== "teacher") {
      return fail(403, "Only a teacher can view these submissions.");
    }
    const assignment = findAssignment(submissionPath[1]);
    if (!assignment) {
      return fail(400, "That assignment does not exist.");
    }
    const rows = mockSubmissions.filter(function (item) {
      return item.assignmentId === assignment.id;
    });
    return {
      data: rows.map(function (item) {
        return {
          id: item.id,
          studentEmail: item.studentEmail,
          fileName: item.fileName,
          submittedAt: item.submittedAt,
          status: item.status
        };
      })
    };
  }

  return fail(400, "Unknown request.");
}

function fail(status, message) {
  return { status: status, error: message };
}

function findAssignment(id) {
  return mockAssignments.find(function (item) {
    return item.id === id;
  });
}

// A copy, so a console experiment cannot overwrite the saved sample.
function copyItem(item) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    deadline: item.deadline
  };
}

/*
  Used only when USE_MOCK is false. The pages already call these paths:

    GET  /api/me
    GET  /api/assignments
    POST /api/assignments
    POST /api/assignments/:id/submissions   (multipart field name "file")
    GET  /api/my-submissions
    GET  /api/assignments/:id/submissions

  Every request sends Authorization: Bearer <idToken>.
  A file upload is FormData. Leaving Content-Type unset lets the browser
  add the multipart boundary. An error body { error: "message" } is thrown
  so the page can show err.message, same as the sample data.
*/
async function realRequest(method, path, settings) {
  const token = await freshIdToken();
  const headers = {};
  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  let body;
  if (settings.file) {
    body = new FormData();
    body.append("file", settings.file);
  } else if (settings.body) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(settings.body);
  }

  const response = await fetch(path, {
    method: method,
    headers: headers,
    body: body
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (ignore) {
    payload = {};
  }

  if (!response.ok) {
    throw requestError(response.status, payload.error || "Something went wrong.");
  }

  return payload;
}

/*
  Spark data layer. Same paths as the sample API, stored in Firestore.

  users/{uid}            email, role ("student" or "teacher")
  assignments/{id}       title, description, deadline (ISO string)
  submissions/{id}       assignmentId, studentUid, studentEmail,
                         fileName, storagePath, submittedAt, status

  The file itself goes in Cloud Storage. Firestore only stores its name.
*/
async function firebaseRequest(method, path, settings) {
  try {
    return await firebaseData(method, path, settings);
  } catch (err) {
    if (err && typeof err.status === "number") {
      throw err;
    }
    throw requestError(400, firebaseDataMessage(err));
  }
}

async function firebaseData(method, path, settings) {
  await firebaseAuth();
  const db = firebase.firestore();
  const me = await currentProfile();

  if (method === "GET" && path === "/api/me") {
    return {
      uid: me.uid,
      email: me.email,
      role: me.role
    };
  }

  if (method === "GET" && path === "/api/assignments") {
    const snap = await db.collection("assignments").get();
    const list = [];
    snap.forEach(function (doc) {
      const data = doc.data();
      list.push({
        id: doc.id,
        title: data.title || "",
        description: data.description || "",
        deadline: data.deadline || ""
      });
    });
    list.sort(function (a, b) {
      return String(a.deadline).localeCompare(String(b.deadline));
    });
    return list;
  }

  if (method === "POST" && path === "/api/assignments") {
    if (me.role !== "teacher") {
      throw requestError(403, "Only a teacher can create an assignment.");
    }
    const body = settings.body || {};
    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();
    const deadline = body.deadline;
    if (!title || !description || !deadline) {
      throw requestError(400, "Title, description, and deadline are required.");
    }
    if (Number.isNaN(Date.parse(deadline))) {
      throw requestError(400, "Deadline must be a valid date.");
    }
    const created = {
      title: title,
      description: description,
      deadline: new Date(deadline).toISOString()
    };
    const ref = await db.collection("assignments").add(created);
    return {
      id: ref.id,
      title: created.title,
      description: created.description,
      deadline: created.deadline
    };
  }

  const submissionPath = path.match(/^\/api\/assignments\/([^/]+)\/submissions$/);

  if (method === "POST" && submissionPath) {
    if (me.role !== "student") {
      throw requestError(403, "Only a student can submit a file.");
    }
    const assignmentId = decodeURIComponent(submissionPath[1]);
    const assignmentSnap = await db.collection("assignments").doc(assignmentId).get();
    if (!assignmentSnap.exists) {
      throw requestError(400, "That assignment does not exist.");
    }
    const assignment = assignmentSnap.data();
    if (Date.parse(assignment.deadline) < Date.now()) {
      throw requestError(400, "The deadline has passed.");
    }
    const file = settings.file;
    if (!file) {
      throw requestError(400, "Choose a file to upload.");
    }
    const fileName = String(file.name || "");
    if (!/\.(pdf|docx|zip)$/i.test(fileName)) {
      throw requestError(400, "Only PDF, DOCX, or ZIP files are allowed.");
    }
    if (file.size > MAX_FILE_BYTES) {
      throw requestError(400, "File must be 10 MB or smaller.");
    }
    const safeName = fileName.replace(/[^\w.\-]+/g, "_");
    const storagePath = "submissions/" + assignmentId + "/" + me.uid + "/" + Date.now() + "-" + safeName;
    await ensureStorageBucket();
    try {
      await putFile(storagePath, file);
    } catch (err) {
      throw requestError(400, storageMessage(err));
    }
    const saved = {
      assignmentId: assignmentId,
      studentUid: me.uid,
      studentEmail: me.email,
      fileName: fileName,
      storagePath: storagePath,
      submittedAt: new Date().toISOString(),
      status: "submitted"
    };
    const ref = await db.collection("submissions").add(saved);
    return { id: ref.id, status: "submitted" };
  }

  if (method === "GET" && path === "/api/my-submissions") {
    const snap = await db.collection("submissions").where("studentUid", "==", me.uid).get();
    const mine = [];
    snap.forEach(function (doc) {
      const data = doc.data();
      mine.push({
        id: doc.id,
        assignmentId: data.assignmentId,
        fileName: data.fileName,
        submittedAt: data.submittedAt,
        status: data.status
      });
    });
    return mine;
  }

  if (method === "GET" && submissionPath) {
    if (me.role !== "teacher") {
      throw requestError(403, "Only a teacher can view these submissions.");
    }
    const assignmentId = decodeURIComponent(submissionPath[1]);
    const assignmentSnap = await db.collection("assignments").doc(assignmentId).get();
    if (!assignmentSnap.exists) {
      throw requestError(400, "That assignment does not exist.");
    }
    const snap = await db.collection("submissions").where("assignmentId", "==", assignmentId).get();
    const rows = [];
    snap.forEach(function (doc) {
      const data = doc.data();
      rows.push({
        id: doc.id,
        studentEmail: data.studentEmail,
        fileName: data.fileName,
        submittedAt: data.submittedAt,
        status: data.status
      });
    });
    return rows;
  }

  throw requestError(400, "Unknown request.");
}

// The signed-in person's role lives in Firestore, not in the password.
async function currentProfile() {
  const user = firebase.auth().currentUser;
  if (!user) {
    throw requestError(403, "Please log in first.");
  }
  const snap = await firebase.firestore().collection("users").doc(user.uid).get();
  const data = snap.exists ? snap.data() : {};
  if (data.role !== "student" && data.role !== "teacher") {
    throw requestError(403, "This account has no role yet. Create it from the portal.");
  }
  return {
    uid: user.uid,
    email: data.email || user.email,
    role: data.role
  };
}

function firebaseDataMessage(err) {
  const code = err && err.code;
  if (code === "permission-denied") {
    return "Firestore blocked this. Open Firestore, then Rules, and allow signed-in users.";
  }
  if (code === "unavailable") {
    return "Could not reach Firestore. Check your internet connection.";
  }
  return (err && err.message) || "Could not reach Firestore.";
}

// The Storage bucket does not exist until Get started is clicked in Firebase.
// Without this check, put() retries for minutes and the button looks frozen.
async function ensureStorageBucket() {
  const bucket = firebaseConfig.storageBucket;
  let response;
  try {
    response = await fetch(
      "https://firebasestorage.googleapis.com/v0/b/" + encodeURIComponent(bucket) + "/o?maxResults=1"
    );
  } catch (ignore) {
    throw requestError(400, "Could not reach Cloud Storage. Check your internet connection.");
  }
  if (response.status === 404) {
    throw requestError(
      400,
      "Cloud Storage is not turned on yet. In Firebase, open Storage, click Get started, then upload again."
    );
  }
}

function putFile(storagePath, file) {
  const storage = firebase.storage();
  storage.setMaxUploadRetryTime(20000);
  storage.setMaxOperationRetryTime(10000);
  const task = storage.ref(storagePath).put(file);
  let timer;
  let timedOut = false;
  const upload = new Promise(function (resolve, reject) {
    task.then(resolve, function (err) {
      if (!timedOut) {
        reject(err);
      }
    });
  });
  const timeout = new Promise(function (_, reject) {
    timer = setTimeout(function () {
      timedOut = true;
      task.cancel();
      reject(new Error("Upload timed out. In Firebase, open Storage and click Get started, then try again."));
    }, 20000);
  });
  return Promise.race([upload, timeout]).then(function (snapshot) {
    clearTimeout(timer);
    return snapshot;
  }, function (err) {
    clearTimeout(timer);
    throw err;
  });
}

function storageMessage(err) {
  const code = err && err.code;
  if (
    code === "storage/unauthorized" ||
    code === "storage/unauthenticated" ||
    code === "storage/bucket-not-found" ||
    code === "storage/unknown" ||
    code === "storage/retry-limit-exceeded" ||
    code === "storage/canceled"
  ) {
    return "Turn on Storage in Firebase: Build, then Storage, then Get started.";
  }
  return (err && err.message) || "Could not upload the file.";
}

// Firebase ID tokens expire. Ask for a current one before each real request.
async function freshIdToken() {
  if (window.firebase && firebase.apps && firebase.apps.length) {
    const user = firebase.auth().currentUser;
    if (user) {
      idToken = await user.getIdToken();
    }
  }
  return idToken;
}

// So the browser console can call api() while you try this step.
window.api = api;

/*
  Login
  -----
  USE_MOCK true: only the two sample accounts in mockUsers are accepted.
  A wrong password throws "Wrong email or password." and the form stays up.
  The signed-in person is kept in sessionStorage, so a refresh does not
  send them back to the form. The password itself is never stored.
*/

const SESSION_KEY = "portal.session";

function startApp() {
  if (USE_MOCK) {
    restoreMockSession();
    if (mockSession) {
      openHome().catch(function () {
        clearSession();
        showLogin();
      });
      return;
    }
    showLogin();
    return;
  }

  // Real mode: Firebase remembers the user. Then /api/me supplies the role.
  restoreFirebaseSession().then(function (signedIn) {
    if (!signedIn) {
      showLogin();
      return;
    }
    return openHome();
  }).catch(function (err) {
    showLogin();
    const error = document.getElementById("form-error");
    if (error) {
      setFormError(error, err.message);
    }
  });
}

// Puts the sample user back after a refresh. Ignored when the JSON is bad.
function restoreMockSession() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) {
    return;
  }
  try {
    const saved = JSON.parse(raw);
    if (!saved.email || !saved.role) {
      return;
    }
    mockSession = {
      uid: saved.uid,
      email: saved.email,
      role: saved.role
    };
    idToken = saved.idToken || null;
  } catch (ignore) {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

function rememberUser(user) {
  mockSession = {
    uid: user.uid,
    email: user.email,
    role: user.role
  };
  // Stand-in for the Firebase ID token. realRequest() will send it later.
  idToken = "mock-token-" + user.uid;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    uid: user.uid,
    email: user.email,
    role: user.role,
    idToken: idToken
  }));
}

function clearSession() {
  mockSession = null;
  idToken = null;
  sessionStorage.removeItem(SESSION_KEY);
}

async function signIn(email, password) {
  if (USE_MOCK) {
    return signInWithMock(email, password);
  }
  return signInWithFirebase(email, password);
}

/*
  Creates the login and the role together.
  The person types an email and a password, then picks Student or Teacher.
  Firebase Auth stores the password. Firestore stores users/{uid}.role.
*/
async function createAccount(email, password, role) {
  const cleanedEmail = String(email || "").trim().toLowerCase();
  if (!cleanedEmail || !password) {
    throw new Error("Enter both your email and password.");
  }
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }
  if (role !== "student" && role !== "teacher") {
    throw new Error("Choose Student or Teacher.");
  }

  if (USE_MOCK) {
    const taken = mockUsers.some(function (user) {
      return user.email === cleanedEmail;
    });
    if (taken) {
      throw new Error("That email is already registered. Log in instead.");
    }
    const created = {
      uid: "user-" + Date.now(),
      email: cleanedEmail,
      password: password,
      role: role
    };
    mockUsers.push(created);
    rememberUser(created);
    return;
  }

  const auth = await firebaseAuth();
  let credential;
  try {
    credential = await auth.createUserWithEmailAndPassword(cleanedEmail, password);
  } catch (err) {
    throw new Error(firebaseSignUpMessage(err));
  }

  try {
    await firebase.firestore().collection("users").doc(credential.user.uid).set({
      email: cleanedEmail,
      role: role
    });
  } catch (err) {
    try {
      await credential.user.delete();
    } catch (ignore) {
      // The login exists, but the role was not saved. The message below says so.
    }
    throw new Error(firebaseDataMessage(err));
  }

  idToken = await credential.user.getIdToken();
}

function firebaseSignUpMessage(err) {
  const code = err && err.code;
  if (code === "auth/email-already-in-use") {
    return "That email is already registered. Log in instead.";
  }
  if (code === "auth/invalid-email") {
    return "Enter a valid email address.";
  }
  if (code === "auth/weak-password") {
    return "Password must be at least 6 characters.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Turn on Email/Password in Firebase: Authentication, then Sign-in method.";
  }
  return (err && err.message) || "Could not create the account.";
}

function signInWithMock(email, password) {
  const cleanedEmail = String(email || "").trim().toLowerCase();
  const match = mockUsers.find(function (user) {
    return user.email === cleanedEmail && user.password === password;
  });
  if (!match) {
    throw new Error("Wrong email or password.");
  }
  rememberUser(match);
}

/*
  Real Firebase email/password sign-in.
  Unused while USE_MOCK is true, so the sample accounts keep working.
  After a role change on the server, log out and sign in again.
  The new ID token is what /api/me reads to decide student or teacher.
*/
const FIREBASE_VERSION = "10.14.1";

async function signInWithFirebase(email, password) {
  const auth = await firebaseAuth();
  let credential;
  try {
    credential = await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    throw new Error(firebaseSignInMessage(err));
  }
  idToken = await credential.user.getIdToken();
}

async function restoreFirebaseSession() {
  const auth = await firebaseAuth();
  const user = await new Promise(function (resolve) {
    const stop = auth.onAuthStateChanged(function (next) {
      stop();
      resolve(next || null);
    });
  });
  if (!user) {
    return false;
  }
  idToken = await user.getIdToken();
  return true;
}

async function firebaseAuth() {
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY") {
    throw new Error("Paste the real firebaseConfig, then set USE_MOCK to false.");
  }
  await loadFirebase();
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  return firebase.auth();
}

function loadFirebase() {
  if (window.firebase && firebase.auth && firebase.firestore && firebase.storage) {
    return Promise.resolve();
  }
  const base = "https://www.gstatic.com/firebasejs/" + FIREBASE_VERSION + "/";
  return loadScript(base + "firebase-app-compat.js").then(function () {
    return loadScript(base + "firebase-auth-compat.js");
  }).then(function () {
    return loadScript(base + "firebase-firestore-compat.js");
  }).then(function () {
    return loadScript(base + "firebase-storage-compat.js");
  });
}

function loadScript(src) {
  return new Promise(function (resolve, reject) {
    const script = document.createElement("script");
    script.src = src;
    script.onload = function () {
      resolve();
    };
    script.onerror = function () {
      reject(new Error("Could not load Firebase."));
    };
    document.head.appendChild(script);
  });
}

function firebaseSignInMessage(err) {
  const code = err && err.code;
  if (
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/user-not-found" ||
    code === "auth/invalid-email"
  ) {
    return "Wrong email or password.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Wait a moment and try again.";
  }
  return (err && err.message) || "Could not sign in.";
}

function logOut() {
  const done = function () {
    currentUser = null;
    currentPageId = null;
    clearSession();
    showLogin();
  };
  if (USE_MOCK || !window.firebase || !firebase.apps || !firebase.apps.length) {
    done();
    return;
  }
  firebase.auth().signOut().then(done).catch(done);
}

// Simple line drawing for the welcome panel. It is original, not a copied picture.
function welcomeArt() {
  return '<svg class="welcome-art" viewBox="0 0 440 260" aria-hidden="true">' +
    '<rect x="168" y="36" width="150" height="190" rx="16" fill="none" stroke="#fff" stroke-width="3"/>' +
    '<line x1="190" y1="68" x2="296" y2="68" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
    '<line x1="190" y1="92" x2="276" y2="92" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
    '<line x1="190" y1="116" x2="286" y2="116" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="243" cy="168" r="28" fill="none" stroke="#fff" stroke-width="3"/>' +
    '<path d="M232 168 h22 M243 157 v22" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="78" cy="118" r="16" fill="none" stroke="#fff" stroke-width="3"/>' +
    '<path d="M52 196c6-34 18-48 26-48s20 14 26 48" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="372" cy="108" r="16" fill="none" stroke="#fff" stroke-width="3"/>' +
    '<path d="M346 186c6-34 18-48 26-48s20 14 26 48" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
    '<rect x="330" y="150" width="36" height="24" rx="4" fill="none" stroke="#fff" stroke-width="3"/>' +
    "</svg>";
}

function showLogin(view) {
  // Full-screen split: dark form on the left, welcome panel on the right.
  const creating = view === "create";
  document.body.classList.add("is-login");
  document.getElementById("app").classList.remove("is-auth");
  const practice = USE_MOCK
    ? '<aside class="practice-accounts">' +
      "<p><strong>Practice accounts</strong></p>" +
      "<p>Student: student@school.edu / student123</p>" +
      "<p>Teacher: teacher@school.edu / teacher123</p>" +
      "</aside>"
    : "";
  const roleFields = creating
    ? '<fieldset class="role-choice">' +
      "<legend>I am a</legend>" +
      '<div class="role-options">' +
      '<label><input type="radio" name="role" value="student" checked> Student</label>' +
      '<label><input type="radio" name="role" value="teacher"> Teacher</label>' +
      "</div>" +
      "</fieldset>"
    : "";

  document.getElementById("app").innerHTML =
    '<div class="login-split">' +
    '<section class="login-form-side">' +
    "<h2>" + (creating ? "Create account" : "Login") + "</h2>" +
    '<p class="lead">' + (creating
      ? "Type an email and a password, then pick a role."
      : "Enter your account details") + "</p>" +
    '<p id="form-error" class="form-error" role="alert" hidden></p>' +
    '<form id="login-form" novalidate>' +
    '<div class="field">' +
    '<label for="email">Email</label>' +
    '<input id="email" name="email" type="email" autocomplete="username" required>' +
    "</div>" +
    '<div class="field">' +
    '<label for="password">Password</label>' +
    '<input id="password" name="password" type="password" autocomplete="' +
    (creating ? "new-password" : "current-password") + '" required>' +
    "</div>" +
    roleFields +
    '<button class="primary" type="submit">' + (creating ? "Create account" : "Login") + "</button>" +
    "</form>" +
    '<button type="button" class="text-button" id="switch-auth">' +
    (creating ? "Already have an account? Login" : "New here? Create account") +
    "</button>" +
    (creating ? "" : practice) +
    "</section>" +
    '<section class="login-welcome" aria-label="Welcome">' +
    "<h2>Welcome to<br>assignment portal</h2>" +
    "<p>Sign in to turn in work, or to see who submitted.</p>" +
    welcomeArt() +
    "</section>" +
    "</div>";

  renderHeader();

  document.getElementById("switch-auth").addEventListener("click", function () {
    showLogin(creating ? "login" : "create");
  });

  const form = document.getElementById("login-form");
  const error = document.getElementById("form-error");
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    if (!String(email).trim() || !password) {
      setFormError(error, "Enter both your email and password.");
      return;
    }
    const button = form.querySelector("button");
    button.disabled = true;
    if (creating) {
      const selected = form.querySelector('input[name="role"]:checked');
      const role = selected ? selected.value : "";
      button.textContent = "Creating...";
      createAccount(email, password, role).then(function () {
        return openHome();
      }).catch(function (err) {
        setFormError(error, err.message);
        button.disabled = false;
        button.textContent = "Create account";
      });
      return;
    }
    button.textContent = "Signing in...";
    signIn(email, password).then(function () {
      return openHome();
    }).catch(function (err) {
      setFormError(error, err.message);
      button.disabled = false;
      button.textContent = "Login";
    });
  });

  document.getElementById("email").focus();
}

/*
  Role shell
  ----------
  After sign-in we ask /api/me for the role, then show only that role's pages.
  A student never gets the teacher links, and a teacher never gets the student links.
  openPage() also refuses a page the role is not allowed to open.
*/

let currentUser = null;
let currentPageId = null;

const STUDENT_PAGES = [
  {
    id: "assignments",
    title: "Assignments",
    text: "Choose an assignment and turn in a PDF, DOCX, or ZIP before the deadline."
  },
  {
    id: "my-submissions",
    title: "My submissions",
    text: "Files you have turned in are listed here."
  }
];

const TEACHER_PAGES = [
  {
    id: "create",
    title: "Create assignment",
    text: "Add a title, a description, and a deadline."
  },
  {
    id: "submissions",
    title: "View submissions",
    text: "See who has turned in work for an assignment."
  }
];

function pagesForRole(role) {
  if (role === "teacher") {
    return TEACHER_PAGES;
  }
  if (role === "student") {
    return STUDENT_PAGES;
  }
  return [];
}

// Asks the API who is signed in, then shows that role's first page.
async function openHome() {
  currentUser = await api("/api/me");
  const pages = pagesForRole(currentUser.role);
  currentPageId = pages.length ? pages[0].id : null;
  renderShell();
}

function renderShell() {
  document.body.classList.remove("is-login");
  const app = document.getElementById("app");
  app.classList.remove("is-auth");
  const pages = currentUser ? pagesForRole(currentUser.role) : [];

  if (!pages.length) {
    app.innerHTML =
      '<section class="home-panel">' +
      "<h2>No pages for this account</h2>" +
      '<p class="lead">Log out and sign in again after your role is set.</p>' +
      "</section>";
    renderHeader();
    return;
  }

  const allowed = pages.some(function (page) {
    return page.id === currentPageId;
  });
  if (!allowed) {
    currentPageId = pages[0].id;
  }

  app.innerHTML =
    '<nav id="page-nav" class="page-nav" aria-label="Your pages"></nav>' +
    '<p id="page-error" class="form-error" role="alert" hidden></p>' +
    '<section id="page-body"></section>';

  const nav = document.getElementById("page-nav");
  pages.forEach(function (page) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-button";
    button.textContent = page.title;
    if (page.id === currentPageId) {
      button.className += " is-active";
      button.setAttribute("aria-current", "page");
    }
    button.addEventListener("click", function () {
      openPage(page.id);
    });
    nav.appendChild(button);
  });

  const page = pages.find(function (item) {
    return item.id === currentPageId;
  });
  renderPage(page);
  renderHeader();
}

// Each role's pages load from the API.
function renderPage(page) {
  if (page.id === "assignments") {
    showAssignments();
    return;
  }
  if (page.id === "my-submissions") {
    showMySubmissions();
    return;
  }
  if (page.id === "create") {
    showCreateAssignment();
    return;
  }
  if (page.id === "submissions") {
    showViewSubmissions();
    return;
  }
  const body = document.getElementById("page-body");
  body.innerHTML = "<h2></h2><p class=\"lead\"></p>";
  body.querySelector("h2").textContent = page.title;
  body.querySelector(".lead").textContent = page.text;
}

/*
  Student assignment list.
  GET /api/assignments returns { id, title, description, deadline }.
  A deadline earlier than now is marked closed, so a late upload can be tested later.
  The date is shown in UTC so every computer shows the same clock time.
*/
function showAssignments() {
  const body = document.getElementById("page-body");
  body.innerHTML = "<h2>Assignments</h2><p class=\"lead\">Loading assignments...</p>";

  api("/api/assignments").then(function (assignments) {
    if (currentPageId !== "assignments") {
      return;
    }
    drawAssignmentList(assignments);
  }).catch(function (err) {
    if (currentPageId !== "assignments") {
      return;
    }
    drawPageError("Assignments", err.message);
  });
}

function drawAssignmentList(assignments) {
  const body = document.getElementById("page-body");
  body.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "Assignments";
  const lead = document.createElement("p");
  lead.className = "lead";
  lead.textContent = "Turn in a PDF, DOCX, or ZIP before the deadline.";
  body.appendChild(heading);
  body.appendChild(lead);

  if (!assignments.length) {
    const empty = document.createElement("p");
    empty.textContent = "No assignments yet.";
    body.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "assignment-list";
  assignments.forEach(function (assignment) {
    list.appendChild(assignmentCard(assignment));
  });
  body.appendChild(list);
}

function assignmentCard(assignment) {
  const closed = isPastDeadline(assignment.deadline);
  const card = document.createElement("article");
  card.className = "assignment-card" + (closed ? " is-closed" : "");

  const top = document.createElement("div");
  top.className = "assignment-top";

  const title = document.createElement("h3");
  title.textContent = assignment.title;

  const status = document.createElement("span");
  status.className = "status-pill " + (closed ? "is-late" : "is-open");
  status.textContent = closed ? "Deadline passed" : "Open";

  const description = document.createElement("p");
  description.className = "assignment-desc";
  description.textContent = assignment.description;

  const deadline = document.createElement("p");
  deadline.className = "deadline";
  deadline.textContent = "Deadline: " + formatUtc(assignment.deadline);

  top.appendChild(title);
  top.appendChild(status);
  card.appendChild(top);
  card.appendChild(description);
  card.appendChild(deadline);
  card.appendChild(uploadForm(assignment));
  return card;
}

/*
  One file picker per assignment.
  Type and size are checked here, before the request, so a bad file is
  stopped immediately. The API checks again, including the deadline, and
  any { error: "message" } is shown in this card.
*/
function uploadForm(assignment) {
  const form = document.createElement("form");
  form.className = "upload-form";

  const row = document.createElement("div");
  row.className = "upload-row";

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pdf,.docx,.zip";
  input.setAttribute("aria-label", "File for " + assignment.title);

  const button = document.createElement("button");
  button.type = "submit";
  button.className = "primary";
  button.textContent = "Upload";

  const message = document.createElement("p");
  message.className = "upload-message";
  message.hidden = true;

  row.appendChild(input);
  row.appendChild(button);
  form.appendChild(row);
  form.appendChild(message);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const file = input.files && input.files[0];
    const problem = fileProblem(file);
    if (problem) {
      showUploadMessage(message, "error", problem);
      return;
    }

    message.hidden = true;
    button.disabled = true;
    button.textContent = "Uploading...";
    api("/api/assignments/" + encodeURIComponent(assignment.id) + "/submissions", {
      method: "POST",
      file: file
    }).then(function () {
      showUploadMessage(message, "ok", "Submitted.");
      input.value = "";
    }).catch(function (err) {
      showUploadMessage(message, "error", err.message);
    }).then(function () {
      button.disabled = false;
      button.textContent = "Upload";
    });
  });

  return form;
}

// Same wording as the API, so the message on screen matches either check.
function fileProblem(file) {
  if (!file) {
    return "Choose a file to upload.";
  }
  if (!/\.(pdf|docx|zip)$/i.test(file.name)) {
    return "Only PDF, DOCX, or ZIP files are allowed.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "File must be 10 MB or smaller.";
  }
  return "";
}

function showUploadMessage(message, kind, text) {
  message.hidden = false;
  message.className = "upload-message " + (kind === "ok" ? "is-ok" : "is-error");
  message.setAttribute("role", kind === "ok" ? "status" : "alert");
  message.textContent = text;
}

function isPastDeadline(iso) {
  const time = Date.parse(iso);
  return !Number.isNaN(time) && time < Date.now();
}

function formatUtc(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return String(iso || "");
  }
  const formatted = date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC"
  });
  return formatted + " UTC";
}

/*
  My submissions.
  GET /api/my-submissions returns this student's files only.
  The assignment title comes from GET /api/assignments, matched by id.
  Newest first, so the file just uploaded is at the top.
*/
function showMySubmissions() {
  const body = document.getElementById("page-body");
  body.innerHTML = "<h2>My submissions</h2><p class=\"lead\">Loading your submissions...</p>";

  Promise.all([
    api("/api/my-submissions"),
    api("/api/assignments")
  ]).then(function (results) {
    if (currentPageId !== "my-submissions") {
      return;
    }
    drawMySubmissions(results[0], results[1]);
  }).catch(function (err) {
    if (currentPageId !== "my-submissions") {
      return;
    }
    drawPageError("My submissions", err.message);
  });
}

function drawMySubmissions(submissions, assignments) {
  const titles = {};
  assignments.forEach(function (assignment) {
    titles[assignment.id] = assignment.title;
  });

  const body = document.getElementById("page-body");
  body.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "My submissions";
  const lead = document.createElement("p");
  lead.className = "lead";
  lead.textContent = "Files you have turned in.";
  body.appendChild(heading);
  body.appendChild(lead);

  if (!submissions.length) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "You have not submitted any files yet.";
    body.appendChild(empty);
    return;
  }

  const rows = submissions.slice().sort(function (a, b) {
    return Date.parse(b.submittedAt) - Date.parse(a.submittedAt);
  });

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "data-table";

  const headerRow = document.createElement("tr");
  ["Assignment", "File", "Submitted", "Status"].forEach(function (label) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    headerRow.appendChild(th);
  });
  const thead = document.createElement("thead");
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach(function (item) {
    const tr = document.createElement("tr");
    const values = [
      ["Assignment", titles[item.assignmentId] || item.assignmentId],
      ["File", item.fileName],
      ["Submitted", formatUtc(item.submittedAt)]
    ];
    values.forEach(function (pair) {
      const td = document.createElement("td");
      td.dataset.label = pair[0];
      td.textContent = pair[1];
      tr.appendChild(td);
    });
    const statusCell = document.createElement("td");
    statusCell.dataset.label = "Status";
    const pill = document.createElement("span");
    pill.className = "status-pill is-open";
    pill.textContent = item.status === "submitted" ? "Submitted" : (item.status || "");
    statusCell.appendChild(pill);
    tr.appendChild(statusCell);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  body.appendChild(wrap);
}

/*
  Teacher: create an assignment.
  POST /api/assignments with { title, description, deadline }.
  The deadline from the form is local time; the API stores an ISO string (UTC).
  A missing field comes back as { error: "..." } and that sentence is shown here.
*/
function showCreateAssignment() {
  const body = document.getElementById("page-body");
  body.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "Create assignment";
  const lead = document.createElement("p");
  lead.className = "lead";
  lead.textContent = "Students will see this on their assignment list.";

  const form = document.createElement("form");
  form.className = "create-form";
  form.noValidate = true;
  form.appendChild(labeledControl("title", "Title", "text"));
  form.appendChild(labeledControl("description", "Description", "textarea"));

  const deadlineField = labeledControl("deadline", "Deadline", "datetime-local");
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Enter your local time. It is stored in UTC.";
  deadlineField.appendChild(hint);
  form.appendChild(deadlineField);

  const button = document.createElement("button");
  button.type = "submit";
  button.className = "primary";
  button.textContent = "Create assignment";

  const message = document.createElement("p");
  message.className = "upload-message";
  message.hidden = true;

  form.appendChild(message);
  form.appendChild(button);
  body.appendChild(heading);
  body.appendChild(lead);
  body.appendChild(form);
  document.getElementById("title").focus();

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const title = document.getElementById("title").value.trim();
    const description = document.getElementById("description").value.trim();
    const rawDeadline = document.getElementById("deadline").value;
    let deadline = "";
    if (rawDeadline) {
      const parsed = Date.parse(rawDeadline);
      if (Number.isNaN(parsed)) {
        showUploadMessage(message, "error", "Deadline must be a valid date.");
        return;
      }
      deadline = new Date(parsed).toISOString();
    }

    button.disabled = true;
    button.textContent = "Saving...";
    api("/api/assignments", {
      method: "POST",
      body: {
        title: title,
        description: description,
        deadline: deadline
      }
    }).then(function () {
      showUploadMessage(message, "ok", "Assignment created.");
      form.reset();
    }).catch(function (err) {
      showUploadMessage(message, "error", err.message);
    }).then(function () {
      button.disabled = false;
      button.textContent = "Create assignment";
    });
  });
}

function labeledControl(id, labelText, type) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;
  let control;
  if (type === "textarea") {
    control = document.createElement("textarea");
    control.rows = 4;
  } else {
    control = document.createElement("input");
    control.type = type;
  }
  control.id = id;
  control.name = id;
  wrap.appendChild(label);
  wrap.appendChild(control);
  return wrap;
}

/*
  Teacher: view submissions for one assignment.
  GET /api/assignments/:id/submissions is teacher-only.
  A student who calls it gets 403 and { error: "Only a teacher can view these submissions." }.
*/
function showViewSubmissions() {
  const body = document.getElementById("page-body");
  body.innerHTML = "<h2>View submissions</h2><p class=\"lead\">Loading assignments...</p>";

  api("/api/assignments").then(function (assignments) {
    if (currentPageId !== "submissions") {
      return;
    }
    drawSubmissionPicker(assignments);
  }).catch(function (err) {
    if (currentPageId !== "submissions") {
      return;
    }
    drawPageError("View submissions", err.message);
  });
}

function drawSubmissionPicker(assignments) {
  const body = document.getElementById("page-body");
  body.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "View submissions";
  const lead = document.createElement("p");
  lead.className = "lead";
  lead.textContent = "Choose an assignment to see who turned in a file.";
  body.appendChild(heading);
  body.appendChild(lead);

  if (!assignments.length) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "No assignments yet.";
    body.appendChild(empty);
    return;
  }

  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  label.htmlFor = "assignment-picker";
  label.textContent = "Assignment";
  const select = document.createElement("select");
  select.id = "assignment-picker";
  assignments.forEach(function (assignment) {
    const option = document.createElement("option");
    option.value = assignment.id;
    option.textContent = assignment.title;
    select.appendChild(option);
  });
  field.appendChild(label);
  field.appendChild(select);

  const results = document.createElement("div");
  results.id = "submission-results";
  body.appendChild(field);
  body.appendChild(results);

  select.addEventListener("change", function () {
    loadSubmissions(select.value);
  });
  loadSubmissions(select.value);
}

function loadSubmissions(assignmentId) {
  const results = document.getElementById("submission-results");
  if (!results) {
    return;
  }
  results.innerHTML = "<p class=\"lead\">Loading submissions...</p>";

  api("/api/assignments/" + encodeURIComponent(assignmentId) + "/submissions").then(function (rows) {
    if (currentPageId !== "submissions") {
      return;
    }
    drawSubmissionRows(rows);
  }).catch(function (err) {
    if (currentPageId !== "submissions") {
      return;
    }
    const box = document.getElementById("submission-results");
    if (!box) {
      return;
    }
    box.innerHTML = "";
    const message = document.createElement("p");
    message.className = "form-error";
    message.setAttribute("role", "alert");
    message.textContent = err.message;
    box.appendChild(message);
  });
}

function drawSubmissionRows(rows) {
  const results = document.getElementById("submission-results");
  results.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "No one has submitted this assignment yet.";
    results.appendChild(empty);
    return;
  }

  const ordered = rows.slice().sort(function (a, b) {
    return Date.parse(b.submittedAt) - Date.parse(a.submittedAt);
  });

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "data-table";

  const headerRow = document.createElement("tr");
  ["Student", "File", "Submitted", "Status"].forEach(function (label) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    headerRow.appendChild(th);
  });
  const thead = document.createElement("thead");
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  ordered.forEach(function (item) {
    const tr = document.createElement("tr");
    const values = [
      ["Student", item.studentEmail],
      ["File", item.fileName],
      ["Submitted", formatUtc(item.submittedAt)]
    ];
    values.forEach(function (pair) {
      const td = document.createElement("td");
      td.dataset.label = pair[0];
      td.textContent = pair[1];
      tr.appendChild(td);
    });
    const statusCell = document.createElement("td");
    statusCell.dataset.label = "Status";
    const pill = document.createElement("span");
    pill.className = "status-pill is-open";
    pill.textContent = item.status === "submitted" ? "Submitted" : (item.status || "");
    statusCell.appendChild(pill);
    tr.appendChild(statusCell);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  results.appendChild(wrap);
}

function drawPageError(title, message) {
  const body = document.getElementById("page-body");
  body.innerHTML = "<h2></h2><p class=\"form-error\" role=\"alert\"></p>";
  body.querySelector("h2").textContent = title;
  body.querySelector(".form-error").textContent = message;
}

// Switches the visible page. A role cannot open the other role's page.
function openPage(pageId) {
  const pages = pagesForRole(currentUser.role);
  const allowed = pages.some(function (page) {
    return page.id === pageId;
  });
  if (!allowed) {
    renderShell();
    const error = document.getElementById("page-error");
    error.hidden = false;
    error.textContent = currentUser.role === "student"
      ? "Only a teacher can open this page."
      : "Only a student can open this page.";
    return;
  }
  currentPageId = pageId;
  renderShell();
}

function setFormError(error, message) {
  error.hidden = false;
  error.textContent = message;
}

function renderHeader() {
  const slot = document.getElementById("header-actions");
  slot.innerHTML = "";
  const user = currentUser || mockSession;
  if (!user) {
    return;
  }

  const email = document.createElement("span");
  email.className = "header-user";
  email.textContent = user.email;
  slot.appendChild(email);

  if (user.role === "student" || user.role === "teacher") {
    const role = document.createElement("span");
    role.className = "role-pill";
    role.textContent = user.role === "teacher" ? "Teacher" : "Student";
    slot.appendChild(role);
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-button";
  button.textContent = "Log out";
  button.addEventListener("click", logOut);
  slot.appendChild(button);
}

startApp();
