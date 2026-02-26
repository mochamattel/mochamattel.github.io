import { auth, db } from './firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  type User as FirebaseUser,
  type Unsubscribe
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  addDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  type DocumentData,
  type QuerySnapshot,
  type Unsubscribe as FsUnsubscribe
} from 'firebase/firestore';

// ==================== AUTH FUNCTIONS ====================

export const signUp = async (
  email: string,
  password: string,
  username: string,
  displayName: string,
  birthDate: string
) => {
  // 1. Create Firebase Auth account
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const uid = credential.user.uid;

  // 2. Create user profile document in Firestore
  await setDoc(doc(db, 'users', uid), {
    uid,
    username,
    displayName,
    email,
    birthDate,
    points: 50,
    admirersCount: 0,
    mutualsCount: 0,
    admiringCount: 0,
    strikes: 0,
    isOnline: true,
    activity: 'Idle',
    isPremium: false,
    premiumSince: null,
    createdAt: serverTimestamp()
  });

  // 3. Create username lookup document for uniqueness checking + login
  await setDoc(doc(db, 'usernames', username.toLowerCase()), { uid, email });

  return { uid, username, displayName, email, birthDate };
};

export const logIn = async (emailOrUsername: string, password: string) => {
  let email = emailOrUsername;

  // If not an email, look up username to get email
  // NOTE: usernames collection must be readable without auth (public lookup)
  if (!emailOrUsername.includes('@')) {
    const usernameDoc = await getDoc(doc(db, 'usernames', emailOrUsername.toLowerCase()));
    if (!usernameDoc.exists()) {
      throw new Error('Invalid username or password.');
    }
    const data = usernameDoc.data();
    // Prefer email stored directly in usernames doc (avoids needing auth to read users profile)
    if (data.email) {
      email = data.email;
    } else {
      // Fallback for old accounts: try reading user profile
      try {
        const userDoc = await getDoc(doc(db, 'users', data.uid));
        if (!userDoc.exists()) {
          throw new Error('Please log in with your email address instead of username.');
        }
        email = userDoc.data().email;
      } catch (e: any) {
        // If permission denied (not authed yet), ask user to use email
        throw new Error('Please log in with your email address instead of username.');
      }
    }
  }

  const credential = await signInWithEmailAndPassword(auth, email, password);
  const uid = credential.user.uid;

  // Fetch user profile from Firestore
  const userDoc = await getDoc(doc(db, 'users', uid));
  if (!userDoc.exists()) {
    throw new Error('User profile not found');
  }

  return { uid, ...userDoc.data() };
};

export const logOut = async () => {
  await signOut(auth);
};

export const onAuthChange = (callback: (user: FirebaseUser | null) => void): Unsubscribe => {
  return onAuthStateChanged(auth, callback);
};

export const getCurrentFirebaseUser = (): FirebaseUser | null => {
  return auth.currentUser;
};

export const checkUsernameAvailable = async (username: string): Promise<boolean> => {
  const usernameDoc = await getDoc(doc(db, 'usernames', username.toLowerCase()));
  return !usernameDoc.exists();
};

export const getUserProfile = async (uid: string) => {
  const userDoc = await getDoc(doc(db, 'users', uid));
  if (!userDoc.exists()) return null;
  return { uid, ...userDoc.data() };
};

export const updateUserProfile = async (uid: string, data: Partial<DocumentData>) => {
  await updateDoc(doc(db, 'users', uid), data);
};

// Atomic array operations for library (order-independent, no race conditions)
export const addBookToLibrary = async (uid: string, bookId: string) => {
  await updateDoc(doc(db, 'users', uid), {
    ownedBookIds: arrayUnion(bookId),
    purchasedBookIds: arrayUnion(bookId),
  });
};

export const removeBookFromLibrary = async (uid: string, bookId: string) => {
  await updateDoc(doc(db, 'users', uid), {
    ownedBookIds: arrayRemove(bookId),
    purchasedBookIds: arrayRemove(bookId),
  });
};

export const changePassword = async (newPassword: string) => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  await updatePassword(user, newPassword);
};

// ==================== USER QUERY FUNCTIONS ====================

export const getAllUsers = async () => {
  const snapshot = await getDocs(collection(db, 'users'));
  return snapshot.docs.map(d => ({ uid: d.id, ...d.data() }));
};

export const getUserByUsername = async (username: string) => {
  const usernameDoc = await getDoc(doc(db, 'usernames', username.toLowerCase()));
  if (!usernameDoc.exists()) return null;
  const uid = usernameDoc.data().uid;
  return getUserProfile(uid);
};

// ==================== BOOK FUNCTIONS ====================

export const createBook = async (bookData: any) => {
  const bookRef = doc(collection(db, 'books'));
  const bookWithId = {
    ...bookData,
    id: bookRef.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(bookRef, bookWithId);
  return bookWithId;
};

export const updateBook = async (bookId: string, data: any) => {
  // Find the Firestore document with matching id field
  const q = query(collection(db, 'books'), where('id', '==', bookId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    console.error('Book not found in Firestore:', bookId);
    return;
  }
  const docRef = snapshot.docs[0].ref;
  await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
};

export const deleteBook = async (bookId: string) => {
  const q = query(collection(db, 'books'), where('id', '==', bookId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return;
  await deleteDoc(snapshot.docs[0].ref);
};

export const getBook = async (bookId: string) => {
  const q = query(collection(db, 'books'), where('id', '==', bookId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return snapshot.docs[0].data();
};

export const getAllBooks = async () => {
  const snapshot = await getDocs(collection(db, 'books'));
  return snapshot.docs.map(d => d.data());
};

// Real-time listener for all books
export const subscribeToBooksChanges = (
  callback: (books: any[]) => void
): Unsubscribe => {
  return onSnapshot(collection(db, 'books'), (snapshot: QuerySnapshot) => {
    const books = snapshot.docs.map(d => d.data());
    callback(books);
  });
};

// ==================== RELATIONSHIPS ====================

export const addRelationship = async (admirer: string, target: string) => {
  await addDoc(collection(db, 'relationships'), {
    admirer,
    target,
    timestamp: new Date().toISOString()
  });
};

export const removeRelationship = async (admirer: string, target: string) => {
  const q = query(collection(db, 'relationships'), where('admirer', '==', admirer), where('target', '==', target));
  const snapshot = await getDocs(q);
  for (const d of snapshot.docs) await deleteDoc(d.ref);
};

export const removeAllRelationshipsForUser = async (username: string) => {
  // Remove where user is admirer
  const q1 = query(collection(db, 'relationships'), where('admirer', '==', username));
  const s1 = await getDocs(q1);
  for (const d of s1.docs) await deleteDoc(d.ref);
  // Remove where user is target
  const q2 = query(collection(db, 'relationships'), where('target', '==', username));
  const s2 = await getDocs(q2);
  for (const d of s2.docs) await deleteDoc(d.ref);
};

export const removeRelationshipsBetween = async (user1: string, user2: string) => {
  await removeRelationship(user1, user2);
  await removeRelationship(user2, user1);
};

export const checkRelationshipExists = async (admirer: string, target: string): Promise<boolean> => {
  const q = query(collection(db, 'relationships'), where('admirer', '==', admirer), where('target', '==', target));
  const snapshot = await getDocs(q);
  return !snapshot.empty;
};

export const subscribeToRelationships = (callback: (rels: any[]) => void): Unsubscribe => {
  return onSnapshot(collection(db, 'relationships'), (snapshot: QuerySnapshot) => {
    callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  });
};

// ==================== CHAT MESSAGES ====================

export const sendChatMessage = async (from: string, to: string, text: string) => {
  const msg = {
    id: Math.random().toString(36).substr(2, 9),
    from,
    to,
    text,
    timestamp: new Date().toISOString(),
    read: false
  };
  await addDoc(collection(db, 'chatMessages'), msg);
  return msg;
};

export const markMessagesRead = async (from: string, to: string) => {
  const q = query(collection(db, 'chatMessages'), where('from', '==', from), where('to', '==', to));
  const snapshot = await getDocs(q);
  for (const d of snapshot.docs) {
    if (!d.data().read) await updateDoc(d.ref, { read: true });
  }
};

export const deleteChatMessagesOlderThan = async (cutoffDate: string) => {
  const q = query(collection(db, 'chatMessages'));
  const snapshot = await getDocs(q);
  for (const d of snapshot.docs) {
    if (d.data().timestamp < cutoffDate) await deleteDoc(d.ref);
  }
};

export const subscribeToChatMessages = (callback: (msgs: any[]) => void): Unsubscribe => {
  return onSnapshot(collection(db, 'chatMessages'), (snapshot: QuerySnapshot) => {
    callback(snapshot.docs.map(d => ({ ...d.data() })));
  });
};

// ==================== NOTIFICATIONS ====================

export const addNotificationDoc = async (notif: any) => {
  await addDoc(collection(db, 'notifications'), notif);
};

export const markNotificationsRead = async (recipientUsername: string) => {
  const q = query(collection(db, 'notifications'), where('recipient', '==', recipientUsername));
  const snapshot = await getDocs(q);
  for (const d of snapshot.docs) {
    if (!d.data().read) await updateDoc(d.ref, { read: true });
  }
};

export const subscribeToNotifications = (callback: (notifs: any[]) => void): Unsubscribe => {
  return onSnapshot(collection(db, 'notifications'), (snapshot: QuerySnapshot) => {
    callback(snapshot.docs.map(d => ({ ...d.data() })));
  });
};

// ==================== COMMENTS ====================

export const addCommentDoc = async (comment: any) => {
  await addDoc(collection(db, 'comments'), comment);
};

export const updateComment = async (commentId: string, data: any) => {
  const q = query(collection(db, 'comments'), where('id', '==', commentId));
  const snapshot = await getDocs(q);
  if (!snapshot.empty) await updateDoc(snapshot.docs[0].ref, data);
};

export const removeCommentDoc = async (commentId: string) => {
  const q = query(collection(db, 'comments'), where('id', '==', commentId));
  const snapshot = await getDocs(q);
  if (!snapshot.empty) await deleteDoc(snapshot.docs[0].ref);
};

export const removeCommentsByAuthor = async (authorUsername: string) => {
  const q = query(collection(db, 'comments'), where('authorUsername', '==', authorUsername));
  const snapshot = await getDocs(q);
  for (const d of snapshot.docs) await deleteDoc(d.ref);
};

export const subscribeToComments = (callback: (comments: any[]) => void): Unsubscribe => {
  return onSnapshot(collection(db, 'comments'), (snapshot: QuerySnapshot) => {
    callback(snapshot.docs.map(d => ({ ...d.data() })));
  });
};

// ==================== REPORTS ====================

export const addReportDoc = async (report: any) => {
  await addDoc(collection(db, 'reports'), report);
};

export const updateReportStatus = async (reportId: string, status: string) => {
  const q = query(collection(db, 'reports'), where('id', '==', reportId));
  const snapshot = await getDocs(q);
  if (!snapshot.empty) await updateDoc(snapshot.docs[0].ref, { status });
};

export const subscribeToReports = (callback: (reports: any[]) => void): Unsubscribe => {
  return onSnapshot(collection(db, 'reports'), (snapshot: QuerySnapshot) => {
    callback(snapshot.docs.map(d => ({ ...d.data() })));
  });
};
