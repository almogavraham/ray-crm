import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyBEZ8wmSNBrC64if5XkMnZRw5xrCAIzB7E',
  authDomain: 'chex-crm.firebaseapp.com',
  projectId: 'chex-crm',
  storageBucket: 'chex-crm.firebasestorage.app',
  messagingSenderId: '1006025078719',
  appId: '1:1006025078719:web:c5a2755849245d0c9d930a',
  measurementId: 'G-3D1DWP4HJP',
};

const app = initializeApp(firebaseConfig);
export const db      = getFirestore(app);
export const auth    = getAuth(app);
export const storage = getStorage(app);
