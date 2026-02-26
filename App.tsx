import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, Environment, PerspectiveCamera, useGLTF } from '@react-three/drei';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import * as fbService from './firebaseService';

/**
 * MainWRLD- Full Integrated Creator & Reader Platform
 */

// Base path for assets - uses Vite's base URL config for GitHub Pages
const BASE = import.meta.env.BASE_URL;

// --- Stripe Configuration ---
// Replace with your Stripe publishable key (use pk_test_ for testing, pk_live_ for production)
const STRIPE_PUBLISHABLE_KEY = 'pk_test_51SxGPW2Urthc1FwfeRDmVhtNVchR7iiZATzRQJcyRjzNLA3ME99cQXQbbgP0ngtnVxAQCckZYcFKAi2vld0w4YR900P0pvdCEO';
declare const Stripe: any;
const getStripe = () => {
  if (typeof Stripe !== 'undefined') {
    return Stripe(STRIPE_PUBLISHABLE_KEY);
  }
  return null;
};

// Stripe Price IDs - Create these products in Stripe Dashboard > Products
// Then paste the price IDs here
const STRIPE_PRICE_IDS: Record<string, string> = {
  // Points packages
  'points_100': 'price_1SxGd02Urthc1FwfJ02cf6Sk',  // $1 for 100 points
  'points_300': 'price_1SxGdI2Urthc1Fwfk1qYWoUs',  // $3 for 300 points
  'points_500': 'price_1SxGdb2Urthc1Fwf7Bi8D5Pd',  // $5 for 500 points
  'points_1000': 'price_1SxGdq2Urthc1FwfPCXOdLMJ', // $10 for 1000 points
};

// Stripe Payment Links - used for client-side checkout (no backend needed)
const STRIPE_PAYMENT_LINKS: Record<string, string> = {
  'points_100': 'https://buy.stripe.com/test_eVq14g1gU4qR2oQ6REdwc03',
  'points_300': 'https://buy.stripe.com/test_9B6aEQe3G8H7gfGb7Udwc02',
  'points_500': 'https://buy.stripe.com/test_28E9AM7Fie1r6F61xkdwc01',
  'points_1000': 'https://buy.stripe.com/test_3cI9AMcZC9Lb1kM8ZMdwc00',
};

// Stripe subscription for Premium membership
const STRIPE_PREMIUM_PAYMENT_LINK = 'https://buy.stripe.com/test_premium'; // Replace with real Stripe Payment Link
const STRIPE_PREMIUM_PRICE_ID = ''; // Replace with Stripe recurring price ID

// For book purchases, Mocha should create a product in Stripe for each book
// OR use a single "Book Purchase" product with variable pricing
const STRIPE_BOOK_PRICE_ID = ''; // Single book product price ID

// --- EmailJS Configuration (for welcome emails) ---
// Sign up at https://www.emailjs.com and create a service + template
// Template should have variables: {{to_email}}, {{to_name}}, {{username}}
const EMAILJS_SERVICE_ID = ''; // e.g. 'service_xxx'
const EMAILJS_TEMPLATE_ID = ''; // e.g. 'template_xxx'
const EMAILJS_PUBLIC_KEY = ''; // e.g. 'user_xxx'
declare const emailjs: any;

const sendWelcomeEmail = async (email: string, displayName: string, username: string) => {
  try {
    if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
      console.log('[MainWRLD] Welcome email skipped — EmailJS not configured.');
      console.log(`[MainWRLD] Would send welcome email to: ${email} for user ${displayName} (@${username})`);
      return;
    }
    if (typeof emailjs === 'undefined') {
      console.log('[MainWRLD] EmailJS SDK not loaded.');
      return;
    }
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: email,
      to_name: displayName,
      username: username,
      app_name: 'MainWRLD',
    }, EMAILJS_PUBLIC_KEY);
    console.log('[MainWRLD] Welcome email sent to', email);
  } catch (err) {
    console.error('[MainWRLD] Failed to send welcome email:', err);
  }
};

// --- Types & Interfaces ---

type View = 
  | 'splash' | 'login' | 'signup' | 'forgot-password'
  | 'home' | 'explore' | 'library' | 'write' | 'publishing' 
  | 'monetization-request' | 'self-profile' | 'customization' 
  | 'profile' | 'book-detail' | 'reading' | 'notifications' 
  | 'notification-settings' | 'settings' | 'comments' | 'blocked-users' | 'admin-dashboard' | 'daily-rewards' | 'cart'
  | 'chat' | 'chat-conversation';

interface User {
  username: string;
  displayName: string;
  isOnline: boolean;
  activity: 'Reading' | 'Writing' | 'Idle';
  position: [number, number, number];
  isMutual: boolean;
  points: number;
  admirersCount: number;
  admirersCount_unlocked?: boolean;
  mutualsCount: number;
  strikes: number;
  admiringCount?: number;
  avatar?: AvatarConfig;
  isPremium?: boolean;
  premiumSince?: string;
  dailyEarnedPoints?: number;
  lastPointsReset?: number;
  membershipStartDate?: number;
  lastMembershipRewardDate?: number;
  dailyChaptersPublished: number;
  lastChapterPublishReset: number;
}

interface UserRecord extends User {
  password: string;
  email?: string;
  birthDate?: string;
}

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  icon: string;
  timestamp: Date;
  recipient: string;
  sender?: string;
  read?: boolean;
}

interface ChatMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: string;
  read: boolean;
}

interface Relationship {
  admirer: string;
  target: string;
  timestamp: string;
}

interface Comment {
  id: string;
  bookId: string;
  chapterIndex?: number; // For per-chapter comments. undefined = book-level comment
  author: string;
  text: string;
  likes: number;
  likedBy?: string[]; // Track who liked the comment to prevent double-liking
  timestamp: string;
}

interface Coupon {
  id: string;
  value: number;
  used: boolean;
}

interface Report {
  id: string;
  type: 'Book' | 'Comment' | 'User';
  targetId: string;
  reportedBy: string;
  timestamp: string;
  status: 'pending' | 'resolved' | 'dismissed';
}

type AvatarGender = 'female' | 'male';
type AvatarCategory = 'body' | 'face' | 'hair' | 'outfit';

interface AvatarConfig {
  gender: AvatarGender;
  bodyId: string;
  faceId: string;
  hairId: string;
  outfitId: string;
}

interface AvatarItem {
  id: string;
  label: string;
  path: string;
  category: AvatarCategory;
  gender: AvatarGender | 'any';
  cost: number;
}

interface Chapter {
  title: string;
  content: string;
}

interface Book {
  id: string;
  title: string;
  author: User;
  coverColor: string;
  coverImage?: string;
  tagline: string;
  genres: string[];
  hashtags: string[];
  likes: number[]; // per-chapter likes array
  commentsCount: number;
  publishedDate: string; // ISO format or YYYY-MM-DD
  isCompleted: boolean;
  wasCompleted?: boolean; // true after ever being marked completed — locks editing
  isExplicit: boolean;
  chaptersCount: number;
  category?: 'Trending' | 'Recently Read' | 'Recommended' | 'Library';
  progress?: number;
  isFavorite?: boolean;
  isDraft?: boolean;
  price?: number; // USD Price for Shopping Cart
  isOwned?: boolean;
  minLikesPerChapter?: number;
  content?: string; // Standardized content storage
  chapters?: Chapter[]; // Added for multiple chapters support
  favoritesLastWeek?: number; // Added for spotlight logic
  monetizationAttempts?: number;
  isMonetized?: boolean;
  wasMonetizedBefore?: boolean;
  commentsEnabled?: boolean;
  isFree?: boolean;
}

// --- Constants ---
const ACCENT_COLOR = '#eb6871';
const WORLD_RADIUS = 50;
const MAX_LIBRARY_SIZE = 35;
const MIN_WORD_COUNT = 150;
const MAX_DAILY_EARNED_POINTS = 25;
const COMMENT_LIKES_THRESHOLD = 50;
const CHAPTER_LIKES_THRESHOLD = 10;
const MAX_DAILY_CHAPTERS = 7;
const MAX_WORD_COUNT = 11000
const GENRE_LIST = ['Mystery', 'Sci-Fi', 'Romance', 'Horror', 'Dystopian', 'Fantasy', 'Action', 'Drama', 'Western', 'Fiction', 'Non-Fiction', 'Thriller', 'FanFic', 'Poetry', 'Religious', 'Erotica', 'LGBTQ+', 'Self-Help', 'Sports'];
const ADMIN_USERNAMES = ['admin', 'mochamattel'];

// Bad words filter for usernames and display names
const BAD_WORDS = ['fuck','dick','cock','bastard','slut','whore','cunt','nigger','nigga','fag','faggot','retard','rape','penis','vagina','anal','porn','hentai','cum','jizz','dildo','sex','xxx','tits','kys','kms','stfu'];
const containsBadWord = (text: string): boolean => {
  const lower = text.toLowerCase().replace(/[^a-z]/g, '');
  return BAD_WORDS.some(word => lower.includes(word));
};

const SKIN_TONE_COLORS: Record<string, string> = {
  A1: '#FDDCC4', A2: '#F2C4A0', A3: '#D9A87C', A4: '#C68E5B', A5: '#A0714A', A6: '#7A5539', A7: '#4A3228',
  B1: '#FDDCC4', B2: '#F2C4A0', B3: '#D9A87C', B4: '#C68E5B', B5: '#A0714A', B6: '#7A5539', B7: '#4A3228',
};

const DEFAULT_HAIR_POSITIONS: Record<string, { width: string; left: string; top: string }> = {
  W_Hair_1:    { width: '33%', left: '33.5%', top: '-2.5%' },
  W_Hair_2:    { width: '35.5%', left: '32.5%', top: '-1.5%' },
  W_Hair_2_v1: { width: '35.5%', left: '32.5%', top: '-1.5%' },
  W_Hair_3:    { width: '35%', left: '32%', top: '-2.5%' },
  W_Hair_4:    { width: '43.5%', left: '28.5%', top: '-4.5%' },
  W_Hair_4_v1: { width: '43.5%', left: '28.5%', top: '-4.5%' },
  W_Hair_5:    { width: '42%', left: '29%', top: '-1.5%' },
  W_Hair_5_v1: { width: '42%', left: '29%', top: '-1.5%' },
  M_Hair_1:    { width: '31%', left: '34%', top: '-4.5%' },
  M_Hair_2:    { width: '36%', left: '32%', top: '-2.5%' },
  M_Hair_3:    { width: '34%', left: '33.5%', top: '-4%' },
  M_Hair_4:    { width: '29%', left: '35.5%', top: '-3%' },
  M_Hair_4_v1: { width: '29%', left: '35.5%', top: '-3%' },
  M_Hair_5:    { width: '37.5%', left: '31.5%', top: '-4%' },
  M_Hair_5_v1: { width: '37.5%', left: '31.5%', top: '-4%' },
};

const DEFAULT_FACE_POSITIONS: Record<string, { width: string; left: string; top: string }> = {
  W_Eye_1:     { width: '23%', left: '38.5%', top: '8%' },
  W_Eye_2:     { width: '23%', left: '38.5%', top: '7.5%' },
  W_Eye_3:     { width: '21%', left: '39.5%', top: '8%' },
  W_Eye_1_v1:  { width: '28%', left: '36%', top: '4.5%' },
  W_Eye_2_v1:  { width: '28%', left: '36%', top: '4.5%' },
  W_Eye_3_v1:  { width: '21%', left: '39.5%', top: '8%' },
  M_Eye_1:     { width: '28%', left: '36%', top: '7%' },
  M_Eye_2:     { width: '22%', left: '39%', top: '7%' },
  M_Eye_3:     { width: '22%', left: '39%', top: '7%' },
  M_Eye_1_v1:  { width: '28%', left: '36%', top: '7%' },
  M_Eye_1_v2:  { width: '28%', left: '36%', top: '7%' },
  M_Eye_2_v1:  { width: '23%', left: '38.5%', top: '7%' },
  M_Eye_2_v2:  { width: '24%', left: '38%', top: '6.5%' },
  M_Eye_3_v1:  { width: '21%', left: '39.5%', top: '7.5%' },
  M_Eye_3_v2:  { width: '21%', left: '39.5%', top: '7.5%' },
};

// Load saved positions from localStorage, fall back to defaults
const loadPositions = (key: string, defaults: Record<string, { width: string; left: string; top: string }>) => {
  try {
    const saved = localStorage.getItem(key);
    if (saved) return { ...defaults, ...JSON.parse(saved) };
  } catch {}
  return { ...defaults };
};

// Clear old hair positions so updated defaults take effect (v4 = Mocha's adjusted positions)
if (!localStorage.getItem('mainwrld_hair_pos_v4')) {
  localStorage.removeItem('mainwrld_hair_positions');
  localStorage.setItem('mainwrld_hair_pos_v4', '1');
}

const HAIR_POSITIONS: Record<string, { width: string; left: string; top: string }> = loadPositions('mainwrld_hair_positions', DEFAULT_HAIR_POSITIONS);
const FACE_POSITIONS: Record<string, { width: string; left: string; top: string }> = loadPositions('mainwrld_face_positions', DEFAULT_FACE_POSITIONS);

const getHairPosition = (hairId: string) => HAIR_POSITIONS[hairId] || { width: '33%', left: '33.5%', top: '-2%' };
const getFacePosition = (faceId: string) => FACE_POSITIONS[faceId] || { width: '28%', left: '36%', top: '4.5%' };

const AVATAR_ITEMS: AvatarItem[] = [
  // Bodies - all free
  { id: 'A1', label: 'Tone 1', path: `${BASE}assets/avatar/body/female/A1.png`, category: 'body', gender: 'female', cost: 0 },
  { id: 'A2', label: 'Tone 2', path: `${BASE}assets/avatar/body/female/A2.png`, category: 'body', gender: 'female', cost: 0 },
  { id: 'A3', label: 'Tone 3', path: `${BASE}assets/avatar/body/female/A3.png`, category: 'body', gender: 'female', cost: 0 },
  { id: 'A4', label: 'Tone 4', path: `${BASE}assets/avatar/body/female/A4.png`, category: 'body', gender: 'female', cost: 0 },
  { id: 'A5', label: 'Tone 5', path: `${BASE}assets/avatar/body/female/A5.png`, category: 'body', gender: 'female', cost: 0 },
  { id: 'A6', label: 'Tone 6', path: `${BASE}assets/avatar/body/female/A6.png`, category: 'body', gender: 'female', cost: 0 },
  { id: 'A7', label: 'Tone 7', path: `${BASE}assets/avatar/body/female/A7.png`, category: 'body', gender: 'female', cost: 0 },
  { id: 'B1', label: 'Tone 1', path: `${BASE}assets/avatar/body/male/B1.png`, category: 'body', gender: 'male', cost: 0 },
  { id: 'B2', label: 'Tone 2', path: `${BASE}assets/avatar/body/male/B2.png`, category: 'body', gender: 'male', cost: 0 },
  { id: 'B3', label: 'Tone 3', path: `${BASE}assets/avatar/body/male/B3.png`, category: 'body', gender: 'male', cost: 0 },
  { id: 'B4', label: 'Tone 4', path: `${BASE}assets/avatar/body/male/B4.png`, category: 'body', gender: 'male', cost: 0 },
  { id: 'B5', label: 'Tone 5', path: `${BASE}assets/avatar/body/male/B5.png`, category: 'body', gender: 'male', cost: 0 },
  { id: 'B6', label: 'Tone 6', path: `${BASE}assets/avatar/body/male/B6.png`, category: 'body', gender: 'male', cost: 0 },
  { id: 'B7', label: 'Tone 7', path: `${BASE}assets/avatar/body/male/B7.png`, category: 'body', gender: 'male', cost: 0 },
  // No face option
  { id: 'no_face', label: 'No Face', path: '', category: 'face', gender: 'any', cost: 0 },
  // Female faces
  { id: 'W_Eye_1', label: 'Face 1', path: `${BASE}assets/avatar/face/W_Eye_1.png`, category: 'face', gender: 'female', cost: 0 },
  { id: 'W_Eye_2', label: 'Face 2', path: `${BASE}assets/avatar/face/W_Eye_2.png`, category: 'face', gender: 'female', cost: 0 },
  { id: 'W_Eye_3', label: 'Face 3', path: `${BASE}assets/avatar/face/W_Eye_3.png`, category: 'face', gender: 'female', cost: 0 },
  { id: 'W_Eye_3_v1', label: 'Face 3 Alt', path: `${BASE}assets/avatar/face/W_Eye_3_v1.png`, category: 'face', gender: 'female', cost: 0 },
  // Male faces
  { id: 'M_Eye_1', label: 'Face 1', path: `${BASE}assets/avatar/face/M_Eye_1.png`, category: 'face', gender: 'male', cost: 0 },
  { id: 'M_Eye_1_v1', label: 'Face 1 Alt', path: `${BASE}assets/avatar/face/M_Eye_1_v1.png`, category: 'face', gender: 'male', cost: 0 },
  { id: 'M_Eye_1_v2', label: 'Face 1 Alt 2', path: `${BASE}assets/avatar/face/M_Eye_1_v2.png`, category: 'face', gender: 'male', cost: 0 },
  { id: 'M_Eye_2', label: 'Face 2', path: `${BASE}assets/avatar/face/M_Eye_2.png`, category: 'face', gender: 'male', cost: 0 },
  { id: 'M_Eye_2_v1', label: 'Face 2 Alt', path: `${BASE}assets/avatar/face/M_Eye_2_v1.png`, category: 'face', gender: 'male', cost: 0 },
  { id: 'M_Eye_2_v2', label: 'Face 2 Alt 2', path: `${BASE}assets/avatar/face/M_Eye_2_v2.png`, category: 'face', gender: 'male', cost: 0 },
  { id: 'M_Eye_3', label: 'Face 3', path: `${BASE}assets/avatar/face/M_Eye_3.png`, category: 'face', gender: 'male', cost: 0 },
  { id: 'M_Eye_3_v1', label: 'Face 3 Alt', path: `${BASE}assets/avatar/face/M_Eye_3_v1.png`, category: 'face', gender: 'male', cost: 0 },
  { id: 'M_Eye_3_v2', label: 'Face 3 Alt 2', path: `${BASE}assets/avatar/face/M_Eye_3_v2.png`, category: 'face', gender: 'male', cost: 0 },
  // No hair option
  { id: 'none', label: 'No Hair', path: '', category: 'hair', gender: 'any', cost: 0 },
  // Female hair
  { id: 'W_Hair_1', label: 'Hair 1', path: `${BASE}assets/avatar/hair/female/W_Hair_1.png`, category: 'hair', gender: 'female', cost: 0 },
  { id: 'W_Hair_2', label: 'Hair 2', path: `${BASE}assets/avatar/hair/female/W_Hair_2.png`, category: 'hair', gender: 'female', cost: 0 },
  { id: 'W_Hair_2_v1', label: 'Hair 2 Alt', path: `${BASE}assets/avatar/hair/female/W_Hair_2_v1.png`, category: 'hair', gender: 'female', cost: 0 },
  { id: 'W_Hair_3', label: 'Hair 3', path: `${BASE}assets/avatar/hair/female/W_Hair_3.png`, category: 'hair', gender: 'female', cost: 0 },
  { id: 'W_Hair_4', label: 'Hair 4', path: `${BASE}assets/avatar/hair/female/W_Hair_4.png`, category: 'hair', gender: 'female', cost: 0 },
  { id: 'W_Hair_4_v1', label: 'Hair 4 Alt', path: `${BASE}assets/avatar/hair/female/W_Hair_4_v1.png`, category: 'hair', gender: 'female', cost: 0 },
  { id: 'W_Hair_5', label: 'Hair 5', path: `${BASE}assets/avatar/hair/female/W_Hair_5.png`, category: 'hair', gender: 'female', cost: 0 },
  { id: 'W_Hair_5_v1', label: 'Hair 5 Alt', path: `${BASE}assets/avatar/hair/female/W_Hair_5_v1.png`, category: 'hair', gender: 'female', cost: 0 },
  // Male hair
  { id: 'M_Hair_1', label: 'Hair 1', path: `${BASE}assets/avatar/hair/male/M_Hair_1.png`, category: 'hair', gender: 'male', cost: 0 },
  { id: 'M_Hair_2', label: 'Hair 2', path: `${BASE}assets/avatar/hair/male/M_Hair_2.png`, category: 'hair', gender: 'male', cost: 0 },
  { id: 'M_Hair_3', label: 'Hair 3', path: `${BASE}assets/avatar/hair/male/M_Hair_3.png`, category: 'hair', gender: 'male', cost: 0 },
  { id: 'M_Hair_4', label: 'Hair 4', path: `${BASE}assets/avatar/hair/male/M_Hair_4.png`, category: 'hair', gender: 'male', cost: 0 },
  { id: 'M_Hair_4_v1', label: 'Hair 4 Alt', path: `${BASE}assets/avatar/hair/male/M_Hair_4_v1.png`, category: 'hair', gender: 'male', cost: 0 },
  { id: 'M_Hair_5', label: 'Hair 5', path: `${BASE}assets/avatar/hair/male/M_Hair_5.png`, category: 'hair', gender: 'male', cost: 0 },
  { id: 'M_Hair_5_v1', label: 'Hair 5 Alt', path: `${BASE}assets/avatar/hair/male/M_Hair_5_v1.png`, category: 'hair', gender: 'male', cost: 0 },
  // Female outfits
  { id: 'D1', label: 'Outfit 1', path: `${BASE}assets/avatar/outfit/female/D1.png`, category: 'outfit', gender: 'female', cost: 0 },
  { id: 'D2', label: 'Outfit 2', path: `${BASE}assets/avatar/outfit/female/D2.png`, category: 'outfit', gender: 'female', cost: 0 },
  { id: 'D3', label: 'Outfit 3', path: `${BASE}assets/avatar/outfit/female/D3.png`, category: 'outfit', gender: 'female', cost: 0 },
  { id: 'D4', label: 'Outfit 4', path: `${BASE}assets/avatar/outfit/female/D4.png`, category: 'outfit', gender: 'female', cost: 0 },
  { id: 'D5', label: 'Outfit 5', path: `${BASE}assets/avatar/outfit/female/D5.png`, category: 'outfit', gender: 'female', cost: 0 },
  // Male outfits
  { id: 'E1', label: 'Outfit 1', path: `${BASE}assets/avatar/outfit/male/E1.png`, category: 'outfit', gender: 'male', cost: 0 },
  { id: 'E2', label: 'Outfit 2', path: `${BASE}assets/avatar/outfit/male/E2.png`, category: 'outfit', gender: 'male', cost: 0 },
  { id: 'E3', label: 'Outfit 3', path: `${BASE}assets/avatar/outfit/male/E3.png`, category: 'outfit', gender: 'male', cost: 0 },
  { id: 'E4', label: 'Outfit 4', path: `${BASE}assets/avatar/outfit/male/E4.png`, category: 'outfit', gender: 'male', cost: 0 },
];

const getAvatarItemPath = (category: AvatarCategory, id: string): string => {
  const item = AVATAR_ITEMS.find(i => i.id === id);
  return item?.path || '';
};

// Helper: renders a cover image inside a book cover div, or fallback title if no image
const CoverImg = ({ book }: { book: Book }) => book.coverImage ? (
  <img src={book.coverImage} className="absolute inset-0 w-full h-full object-cover z-0" />
) : (
  <div className="absolute inset-0 flex items-center justify-center p-4 z-0">
    <span className="text-white text-center font-bold text-lg leading-tight drop-shadow-lg" style={{ textShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>
      
    </span>
  </div>
);



// --- Mock Data ---
const LOREM_CONTENT = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";

const CURRENT_USER_MOCK: User = {
  username: 'alex_writes',
  displayName: 'Alex Rivers',
  isOnline: true,
  activity: 'Idle',
  position: [0, 0, 0],
  isMutual: false,
  points: 1250,
  admirersCount: 856,
  mutualsCount: 42,
  strikes: 0,
};

const MUTUALS: User[] = [
  { username: 'jemma_b', displayName: 'Jemma Blair', isOnline: true, activity: 'Reading', position: [5, 0, -15], isMutual: true, points: 240, admirersCount: 1200, mutualsCount: 88, strikes: 0 },
  { username: 'mark_da_don', displayName: 'Marcus D.', isOnline: true, activity: 'Writing', position: [-12, 0, 8], isMutual: true, points: 15, admirersCount: 450, mutualsCount: 12, strikes: 0 },
];



const INITIAL_BOOKS: Book[] = [
  {
    id: 'e1',
    title: 'Cybergirl',
    author: MUTUALS[0],
    coverColor: '#2b2d42',
    
    category: 'Trending',
    tagline: 'A silent thrill in a digital world.',
    genres: ['Mystery', 'Dystopian'],
    hashtags: ['Cyber', 'Void', 'Echo'],
    likes: [1240],
    commentsCount: 86,
    publishedDate: '2025-01-10',
    isCompleted: false,
    isExplicit: false,
    chaptersCount: 1,
    progress: 45,
    isOwned: false,
    price: 14.99,
    favoritesLastWeek: 850,
    monetizationAttempts: 0,
    commentsEnabled: true,
    minLikesPerChapter: 60,
    content: LOREM_CONTENT,
    chapters: [{ title: 'Chapter 1', content: LOREM_CONTENT }]
    
 
  },
  {
    id: 'p1',
    title: 'Futuregirl',
    author: MUTUALS[1],
    coverColor: '#b8860b',
    
    category: 'Recommended',
    tagline: 'The gold standard of future politics.',
    genres: ['Sci-Fi', 'Romance'],
    hashtags: ['Future', 'Gold'],
    likes: [250, 250],
    commentsCount: 200,
    publishedDate: '2025-12-15',
    isCompleted: true,
    isExplicit: false,
    chaptersCount: 2,
    isOwned: false,
    price: 14.99,
    favoritesLastWeek: 925,
    monetizationAttempts: 0,
    commentsEnabled: true,
    minLikesPerChapter: 15,
    content: LOREM_CONTENT,
    chapters: [{ title: 'Chapter 1', content: LOREM_CONTENT },
    {title: 'Chapter 2', content: LOREM_CONTENT }]

  },
  {
    id: 'e2',
    title: 'Lovergirl',
    author: MUTUALS[0],
    coverColor: '#d4a574',
    
    category: 'Trending',
    tagline: 'Some love stories are found between the pages.',
    genres: ['Romance', 'Fiction'],
    hashtags: ['LoveLetters', 'Historical', 'Mystery', 'Library'],
    likes: [780, 780, 780],
    commentsCount: 0,
    publishedDate: '2026-01-22',
    isCompleted: true,
    isExplicit: false,
    chaptersCount: 3,
    isFavorite: true,
    isOwned: false,
    price: 14.99,
    favoritesLastWeek: 1200,
    monetizationAttempts: 0,
    commentsEnabled: false,
    minLikesPerChapter: 80,
    content: LOREM_CONTENT,
    chapters: [
      { title: 'Chapter 1', content: LOREM_CONTENT },
      { title: 'Chapter 2', content: LOREM_CONTENT },
      { title: 'Chapter 3', content: LOREM_CONTENT }
    ]
  },
];

// --- Shared Components ---

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false }: any) => {
  const base = "h-14 rounded-2xl font-bold text-[11px] uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2";
  const styles: any = {
    primary: "bg-accent text-white shadow-xl shadow-accent/20",
    secondary: "bg-gray-50 dark:bg-gray-900 text-gray-500",
    outline: "border-2 border-gray-100 dark:border-gray-900 text-gray-400",
    ghost: "text-gray-400 hover:text-accent",
    destructive: "bg-red-500/10 text-red-500"
  };
  return (
    <button disabled={disabled} onClick={onClick} className={`${base} ${styles[variant]} ${className} ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}>
      {children}
    </button>
  );
};

const Input = ({ label, type = 'text', value, onChange, placeholder, description, maxLength }: any) => (
  <div className="space-y-1.5 w-full">
    {label && <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-2">{label}</label>}
    <input 
      type={type} 
      value={value || ''} 
      maxLength={maxLength}
      onChange={(e) => onChange && onChange(e.target.value)} 
      placeholder={placeholder} 
      className="w-full bg-gray-50 dark:bg-gray-900 border-none rounded-2xl px-6 py-4 text-sm font-medium focus:ring-2 focus:ring-accent/20 outline-none transition-all" 
    />
    {description && <p className="text-[8px] font-bold text-gray-300 uppercase tracking-tighter ml-2">{description}</p>}
  </div>
);

// --- 3D Components ---

const AvatarModel: React.FC<{ name: string; activity: string; onClick?: () => void; online: boolean; isPlayer?: boolean; skinColor?: string; }> = ({ name, activity, onClick, online, isPlayer, skinColor }) => {
  const { scene } = useGLTF(`${BASE}avatar.glb`);
  const targetColor = isPlayer ? (skinColor || ACCENT_COLOR) : '#334155';

  const clonedScene = useMemo(() => {
    const group = new THREE.Group();
    scene.traverse((child: any) => {
      if (child.isMesh) {
        // Clone the geometry only (not the material)
        const newGeometry = child.geometry.clone();
        // Create fresh material without any textures
        const newMaterial = new THREE.MeshStandardMaterial({
          color: targetColor,
          roughness: 0.6,
          metalness: 0.1
        });
        const newMesh = new THREE.Mesh(newGeometry, newMaterial);
        newMesh.position.copy(child.position);
        newMesh.rotation.copy(child.rotation);
        newMesh.scale.copy(child.scale);
        group.add(newMesh);
      }
    });
    return group;
  }, [scene, targetColor]);

  return (
    <group onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
      <primitive object={clonedScene} scale={1} position={[0, 0, 0]} />
      <Html position={[0, 2.4, 0]} center distanceFactor={10}>
        <div className="flex flex-col items-center pointer-events-none select-none">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-white/95 dark:bg-black/90 backdrop-blur-md rounded-full shadow-lg border border-gray-100 dark:border-gray-800">
            <div className={`w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-gray-300'}`} />
            <span className="text-[10px] font-bold text-black dark:text-white whitespace-nowrap">{name}</span>
          </div>
          <div className="mt-1 px-2 py-0.5 bg-accent/10 rounded-md border border-accent/20"><span className="text-[8px] font-bold uppercase tracking-widest text-accent">{activity}</span></div>
        </div>
      </Html>
    </group>
  );
};

const MovingAvatar: React.FC<{ user: User; onClick?: () => void }> = ({ user, onClick }) => {
  const groupRef = useRef<THREE.Group>(null);
  const targetPos = useRef(new THREE.Vector3(...user.position));
  const waitTimer = useRef(0);

  const getNewTarget = () => {
    return new THREE.Vector3(
      (Math.random() - 0.5) * WORLD_RADIUS * 0.8,
      0,
      (Math.random() - 0.5) * WORLD_RADIUS * 0.8
    );
  };

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    if (waitTimer.current > 0) {
      waitTimer.current -= delta;
      return;
    }

    const currentPos = groupRef.current.position;
    const distance = currentPos.distanceTo(targetPos.current);

    if (distance < 0.2) {
      waitTimer.current = 2 + Math.random() * 5; // Wait 2 to 7 seconds
      targetPos.current = getNewTarget();
    } else {
      const moveDir = targetPos.current.clone().sub(currentPos).normalize();
      currentPos.add(moveDir.clone().multiplyScalar(1.5 * delta)); // Speed 1.5
      
      // Face the direction of travel
      const targetRotation = Math.atan2(moveDir.x, moveDir.z);
      groupRef.current.rotation.y = THREE.MathUtils.lerp(
        groupRef.current.rotation.y,
        targetRotation,
        0.05
      );
    }
  });

  return (
    <group ref={groupRef} position={user.position}>
      <AvatarModel 
        name={user.displayName} 
        activity={user.activity} 
        online={user.isOnline} 
        onClick={onClick} 
      />
    </group>
  );
};

const Player: React.FC<{ moveDir: THREE.Vector3; skinColor?: string }> = ({ moveDir, skinColor }) => {
  const meshRef = useRef<THREE.Group>(null);
  const keys = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const handleDown = (e: KeyboardEvent) => { keys.current[e.code] = true; };
    const handleUp = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    window.addEventListener('keydown', handleDown);
    window.addEventListener('keyup', handleUp);
    return () => { window.removeEventListener('keydown', handleDown); window.removeEventListener('keyup', handleUp); };
  }, []);
  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const { camera } = state;
    const speed = 6 * delta;
    const direction = new THREE.Vector3();
    if (keys.current['KeyW'] || keys.current['ArrowUp']) direction.z -= 1;
    if (keys.current['KeyS'] || keys.current['ArrowDown']) direction.z += 1;
    if (keys.current['KeyA'] || keys.current['ArrowLeft']) direction.x -= 1;
    if (keys.current['KeyD'] || keys.current['ArrowRight']) direction.x += 1;
    if (moveDir.length() > 0) direction.add(moveDir);
    if (direction.length() > 0) { direction.normalize().multiplyScalar(speed); meshRef.current.position.add(direction); meshRef.current.rotation.y = Math.atan2(direction.x, direction.z); }
    const idealOffset = new THREE.Vector3(0, 5, 8).add(meshRef.current.position);
    camera.position.lerp(idealOffset, 0.1); camera.lookAt(meshRef.current.position.x, meshRef.current.position.y + 1, meshRef.current.position.z);
  });
  return <group ref={meshRef}><AvatarModel name="You" activity="Exploring" online={true} isPlayer={true} skinColor={skinColor} /></group>;
};

// --- App Root ---

const App: React.FC = () => {
  const [view, setView] = useState<View>('splash');
  const [toast, setToast] = useState<{ message: string; icon: string } | null>(null);
  const showToast = useCallback((message: string, icon: string = 'check_circle') => {
    setToast({ message, icon });
    setTimeout(() => setToast(null), 2500);
  }, []);
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; confirmLabel?: string; cancelLabel?: string; icon?: string; iconBg?: string; onConfirm: () => void; onCancel?: () => void } | null>(null);
  const showConfirm = useCallback((opts: { title: string; message: string; confirmLabel?: string; cancelLabel?: string; icon?: string; iconBg?: string; onConfirm: () => void; onCancel?: () => void }) => {
    setConfirmModal(opts);
  }, []);
  const BLANK_USER: User = { username: '', displayName: '', isOnline: false, activity: 'Idle', position: [0,0,0], isMutual: false, points: 0, admirersCount: 0, mutualsCount: 0, strikes: 0 };
  const [user, setUser] = useState<User>(BLANK_USER);
  const [authLoading, setAuthLoading] = useState(true);
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [userDataLoaded, setUserDataLoaded] = useState(false); // Guard for persist effects
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [readingChapterIndex, setReadingChapterIndex] = useState(0);
  const [selectedProfileUser, setSelectedProfileUser] = useState<User | null>(null);
  const [selectedChatUser, setSelectedChatUser] = useState<string | null>(null);
  // Chat messages (Firestore real-time)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [moveDir, setMoveDir] = useState(new THREE.Vector3());
  const [readerSettings, setReaderSettings] = useState({ fontSize: 13, inverted: false, scrollMode: true });

  const [likedBooks, setLikedBooks] = useState<Set<string>>(new Set());
  const likedBooksInteracted = useRef(false);
  const [signUpForm, setSignUpForm] = useState({ email: '', birthDate: '', displayName: '', username: '', password: '' });
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [authError, setAuthError] = useState<string | null>(null);

  // Users loaded from Firestore
  const [registeredUsers, setRegisteredUsers] = useState<any[]>([]);

  const isAdmin = ADMIN_USERNAMES.includes(user.username);

  // Check if current user is under 16 (for explicit content filtering)
  const userIsUnder16 = useMemo(() => {
    if (!user.username) return false;
    const userRecord = registeredUsers.find(u => u.username === user.username) as any;
    if (!userRecord?.birthDate) return false;
    const birth = new Date(userRecord.birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age < 16;
  }, [registeredUsers, user.username]);

  // Reports state (Firestore real-time)
  const [reports, setReports] = useState<Report[]>([]);

  // Relationships state (Firestore real-time)
  const [relationships, setRelationships] = useState<Relationship[]>([]);

  // Notifications state (Firestore real-time)
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // Avatar customization state (loaded from Firestore user doc)
  const [allAvatarConfigs, setAllAvatarConfigs] = useState<Record<string, AvatarConfig>>({});

  const avatarConfig = allAvatarConfigs[user.username] || null;
  const setAvatarConfig = useCallback((config: AvatarConfig | null) => {
    setAllAvatarConfigs(prev => {
      if (!config) {
        const next = { ...prev };
        delete next[user.username];
        return next;
      }
      return { ...prev, [user.username]: config };
    });
  }, [user.username]);

  // Unlocked avatar items (loaded from Firestore user doc)
  const [allUnlockedItems, setAllUnlockedItems] = useState<Record<string, string[]>>({});

  const unlockedAvatarItems = useMemo(() => new Set(allUnlockedItems[user.username] || []), [allUnlockedItems, user.username]);
  const setUnlockedAvatarItems = useCallback((updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setAllUnlockedItems(prev => {
      const currentSet = new Set(prev[user.username] || []);
      const newSet = typeof updater === 'function' ? updater(currentSet) : updater;
      return { ...prev, [user.username]: [...newSet] };
    });
  }, [user.username]);

  // Blocked users state (loaded from Firestore user doc)
  const [blockedUsers, setBlockedUsers] = useState<Set<string>>(new Set());

  // Reading activity (loaded from Firestore user doc)
  const [readingActivity, setReadingActivity] = useState<Record<string, { bookId: string; progress: number; lastRead: string }[]>>({});

  // Item price overrides (loaded from Firestore user doc, admin only)
  const [itemPriceOverrides, setItemPriceOverrides] = useState<Record<string, number>>({});

  const getItemCost = (itemId: string): number => {
    if (itemId in itemPriceOverrides) return itemPriceOverrides[itemId];
    const item = AVATAR_ITEMS.find(i => i.id === itemId);
    return item?.cost ?? 0;
  };

  const handleUpdateItemPrice = (itemId: string, price: number) => {
    const updated = { ...itemPriceOverrides, [itemId]: price };
    setItemPriceOverrides(updated);
    if (firebaseUid) fbService.updateUserProfile(firebaseUid, { itemPriceOverrides: updated }).catch(console.error);
  };

  // Comments state (Firestore real-time)
  const [allComments, setAllComments] = useState<Comment[]>([]);

    // Rewards and Cart State
  const [lastClaimedPoints, setLastClaimedPoints] = useState<number | null>(null);
  const [rewardedItems, setRewardedItems] = useState<Set<string>>(new Set());

  // Coupons (loaded from Firestore user doc)
  const [coupons, setCoupons] = useState<Coupon[]>([]);

  // Cart (loaded from Firestore user doc)
  const [cart, setCart] = useState<Book[]>([]);

  // Per-user book ownership and progress (loaded from Firestore user doc)
  const [userBookData, setUserBookData] = useState<Record<string, { ownedBookIds: string[]; purchasedBookIds?: string[]; bookProgress: Record<string, { scrollProgress: number; chapterIndex: number }> }>>({});

  // Helper to get total likes for a book (handles both old number and new number[] format)
  const getTotalLikes = (likes: number | number[]): number => {
    if (Array.isArray(likes)) return likes.reduce((a, b) => a + b, 0);
    return likes || 0;
  };

  // Helper to get chapter likes for a book (ensures array format)
  const getChapterLikes = (likes: number | number[], chapterCount: number): number[] => {
    if (Array.isArray(likes)) {
      // Extend array if needed for new chapters
      const arr = [...likes];
      while (arr.length < chapterCount) arr.push(0);
      return arr;
    }
    // Migrate old format: distribute total evenly or put all on first chapter
    const arr = new Array(Math.max(chapterCount, 1)).fill(0);
    arr[0] = likes || 0;
    return arr;
  };

  // Helper to get current user's owned book IDs
  const getUserOwnedBookIds = useCallback(() => {
    const owned = userBookData[user.username]?.ownedBookIds || [];
    const purchased = userBookData[user.username]?.purchasedBookIds || [];
    return new Set([...owned, ...purchased]);
  }, [userBookData, user.username]);

  // Helper to get current user's progress for a book (returns { scrollProgress, chapterIndex })
  const getUserBookProgress = useCallback((bookId: string): { scrollProgress: number; chapterIndex: number } => {
    const progress = userBookData[user.username]?.bookProgress?.[bookId];
    if (!progress) return { scrollProgress: 0, chapterIndex: 0 };
    // Handle old format migration
    if (typeof progress === 'number') return { scrollProgress: progress, chapterIndex: 0 };
    return progress;
  }, [userBookData, user.username]);

  // Helper to mark a book as owned for current user
  const setUserOwnsBook = useCallback((bookId: string) => {
    setUserBookData(prev => {
      const userData = prev[user.username] || { ownedBookIds: [], bookProgress: {}, purchasedBookIds: [] };
      if (!userData.ownedBookIds.includes(bookId)) {
        userData.ownedBookIds = [...userData.ownedBookIds, bookId];
      }
      // Also track as purchased so removing from library doesn't lose access
      if (!userData.purchasedBookIds) userData.purchasedBookIds = [];
      if (!userData.purchasedBookIds.includes(bookId)) {
        userData.purchasedBookIds = [...userData.purchasedBookIds, bookId];
      }
      return { ...prev, [user.username]: userData };
    });
  }, [user.username]);

  // Helper to update progress for current user (scroll progress + chapter index)
  const setUserBookProgress = useCallback((bookId: string, scrollProgress: number, chapterIndex: number) => {
    setUserBookData(prev => {
      const userData = prev[user.username] || { ownedBookIds: [], bookProgress: {} };
      userData.bookProgress = { ...userData.bookProgress, [bookId]: { scrollProgress, chapterIndex } };
      return { ...prev, [user.username]: userData };
    });
  }, [user.username]);

  // Debounce ref for batched Firestore writes
  const persistTimerRef = useRef<any>(null);
  const pendingAdmireRef = useRef<Set<string>>(new Set());

  // Single debounced persist effect — batches ALL user data into one Firestore write
  // This replaces 8 separate persist effects, reducing writes by ~8x
  useEffect(() => {
    if (!firebaseUid || !user.username || !userDataLoaded) return;
    if (view === 'splash' || view === 'login' || view === 'signup') return;

    // Clear previous timer
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);

    // Debounce: wait 2 seconds of no changes before writing
    persistTimerRef.current = setTimeout(() => {
      const ud = userBookData[user.username];
      const cfg = allAvatarConfigs[user.username];
      const items = allUnlockedItems[user.username];
      const activity = readingActivity[user.username];
      const cartData = cart.map(b => ({ id: b.id, title: b.title, price: b.price, coverColor: b.coverColor, coverImage: b.coverImage }));

      const batchUpdate: Record<string, any> = {
        // User state
        points: user.points,
        displayName: user.displayName,
        strikes: user.strikes,
        admirersCount: user.admirersCount,
        mutualsCount: user.mutualsCount,
        isPremium: user.isPremium || false,
        dailyEarnedPoints: user.dailyEarnedPoints || 0,
        lastPointsReset: user.lastPointsReset || null,
        lastClaimedPoints: lastClaimedPoints || null,
        membershipStartDate: user.membershipStartDate || null,
        lastMembershipRewardDate: user.lastMembershipRewardDate || null,
        dailyChaptersPublished: user.dailyChaptersPublished || 0,
        lastChapterPublishReset: user.lastChapterPublishReset || 0,
        // Book data
        ...(ud ? {
          ownedBookIds: ud.ownedBookIds || [],
          purchasedBookIds: (ud as any).purchasedBookIds || [],
          bookProgress: ud.bookProgress || {},
        } : {}),
        // Avatar
        ...(cfg ? { avatarConfig: cfg } : {}),
        // Unlocked items
        ...(items ? { unlockedItems: items } : {}),
        // Blocked users
        blockedUsers: [...blockedUsers],
        // Reading activity
        ...(activity ? { readingActivity: activity } : {}),
        // Coupons
        coupons,
        // Cart
        cart: cartData,
      };

      fbService.updateUserProfile(firebaseUid, batchUpdate).catch(console.error);
    }, 2000);

    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [
    user.points, user.username, user.displayName, user.isPremium, user.strikes,
    user.admirersCount, user.mutualsCount, user.dailyEarnedPoints, user.lastPointsReset,
    user.membershipStartDate, user.lastMembershipRewardDate, user.dailyChaptersPublished, user.lastChapterPublishReset,
    lastClaimedPoints, userBookData, allAvatarConfigs, allUnlockedItems, blockedUsers,
    readingActivity, coupons, cart,
    firebaseUid, userDataLoaded, view,
  ]);

  // Flush pending persist immediately when user is leaving the page
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!firebaseUid || !user.username || !userDataLoaded) return;
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      const ud = userBookData[user.username];
      const cfg = allAvatarConfigs[user.username];
      const items = allUnlockedItems[user.username];
      const activity = readingActivity[user.username];
      const cartData = cart.map(b => ({ id: b.id, title: b.title, price: b.price, coverColor: b.coverColor, coverImage: b.coverImage }));
      const batchUpdate: Record<string, any> = {
        points: user.points, displayName: user.displayName, strikes: user.strikes,
        admirersCount: user.admirersCount, mutualsCount: user.mutualsCount,
        isPremium: user.isPremium || false, isOnline: false, lastOnline: new Date().toISOString(),
        dailyEarnedPoints: user.dailyEarnedPoints || 0, lastPointsReset: user.lastPointsReset || null,
        lastClaimedPoints: lastClaimedPoints || null,
        membershipStartDate: user.membershipStartDate || null, lastMembershipRewardDate: user.lastMembershipRewardDate || null,
        dailyChaptersPublished: user.dailyChaptersPublished || 0, lastChapterPublishReset: user.lastChapterPublishReset || 0,
        ...(ud ? { ownedBookIds: ud.ownedBookIds || [], purchasedBookIds: (ud as any).purchasedBookIds || [], bookProgress: ud.bookProgress || {} } : {}),
        ...(cfg ? { avatarConfig: cfg } : {}), ...(items ? { unlockedItems: items } : {}),
        blockedUsers: [...blockedUsers], ...(activity ? { readingActivity: activity } : {}), coupons, cart: cartData,
      };
      fbService.updateUserProfile(firebaseUid, batchUpdate).catch(() => {});
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  });

  // Online/offline presence: visibility change + idle timeout
  useEffect(() => {
    if (!firebaseUid || !user.username) return;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

    const setOnline = () => {
      if (!user.isOnline) {
        setUser(prev => ({ ...prev, isOnline: true }));
        fbService.updateUserProfile(firebaseUid, { isOnline: true, lastOnline: new Date().toISOString() }).catch(console.error);
      }
      // Reset idle timer on any activity
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        setUser(prev => ({ ...prev, isOnline: false }));
        fbService.updateUserProfile(firebaseUid, { isOnline: false, lastOnline: new Date().toISOString() }).catch(console.error);
      }, IDLE_TIMEOUT);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden: mark offline
        if (idleTimer) clearTimeout(idleTimer);
        setUser(prev => ({ ...prev, isOnline: false }));
        fbService.updateUserProfile(firebaseUid, { isOnline: false, lastOnline: new Date().toISOString() }).catch(console.error);
      } else {
        // Tab visible again: mark online
        setOnline();
      }
    };

    // Start idle timer
    setOnline();

    // Listen for user activity to reset idle timer
    const activityEvents = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach(evt => window.addEventListener(evt, setOnline, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      activityEvents.forEach(evt => window.removeEventListener(evt, setOnline));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [firebaseUid, user.username]);

  // Publishing temp state
  const [currentPublishingContent, setCurrentPublishingContent] = useState('');
  const [currentPublishingTitle, setCurrentPublishingTitle] = useState('');
  const [currentPublishingId, setCurrentPublishingId] = useState<string | null>(null);
  const [currentPublishingChapterIndex, setCurrentPublishingChapterIndex] = useState<number | null>(null);
  const [publishingInitialData, setPublishingInitialData] = useState<any>(null);

  // Persistence for WriteView state through navigation unmounts
  const [lastSelectedBookId, setLastSelectedBookId] = useState<string>('new');
  const [lastSelectedChapterIndex, setLastSelectedChapterIndex] = useState<string>('new');

  // Subscribe to Firestore books in real-time
  useEffect(() => {
    const unsubscribe = fbService.subscribeToBooksChanges((firestoreBooks: any[]) => {
      const converted = firestoreBooks.map((fb: any) => ({
        ...fb,
        author: {
          username: fb.authorUsername || fb.author?.username || 'unknown',
          displayName: fb.authorDisplayName || fb.author?.displayName || 'Unknown',
          isOnline: false,
          activity: 'Idle' as const,
          position: [0, 0, 0] as [number, number, number],
          isMutual: false,
          points: 0,
          admirersCount: 0,
          mutualsCount: 0,
          strikes: 0,
        },
        // Ensure likes is always an array
        likes: Array.isArray(fb.likes) ? fb.likes : [fb.likes || 0],
        price: fb.price ?? 0,
      }));
      setBooks(converted);
    });
    return () => unsubscribe();
  }, []);

  // Load all registered users from Firestore
  useEffect(() => {
    fbService.getAllUsers().then((users: any[]) => setRegisteredUsers(users)).catch(console.error);
  }, []);

  // ===== FIRESTORE REAL-TIME SUBSCRIPTIONS =====

  // Subscribe to relationships
  useEffect(() => {
    const unsub = fbService.subscribeToRelationships((rels: any[]) => {
      setRelationships(rels.map(r => ({ admirer: r.admirer, target: r.target, timestamp: r.timestamp })));
    });
    return () => unsub();
  }, []);

  // Subscribe to chat messages
  useEffect(() => {
    const unsub = fbService.subscribeToChatMessages((msgs: any[]) => {
      setChatMessages(msgs.map(m => ({ id: m.id, from: m.from, to: m.to, text: m.text, timestamp: m.timestamp, read: m.read })));
    });
    return () => unsub();
  }, []);

  // Subscribe to notifications
  useEffect(() => {
    const unsub = fbService.subscribeToNotifications((notifs: any[]) => {
      setNotifications(notifs.map(n => ({
        id: n.id, title: n.title, message: n.message, icon: n.icon,
        timestamp: n.timestamp ? new Date(n.timestamp) : new Date(),
        recipient: n.recipient, sender: n.sender, read: n.read
      })));
    });
    return () => unsub();
  }, []);

  // Subscribe to comments
  useEffect(() => {
    const unsub = fbService.subscribeToComments((comments: any[]) => {
      setAllComments(comments.map(c => ({
        id: c.id, bookId: c.bookId, chapterIndex: c.chapterIndex,
        author: c.author, authorUsername: c.authorUsername, text: c.text,
        likes: c.likes || 0, likedBy: c.likedBy || [], timestamp: c.timestamp || 'Now'
      })));
    });
    return () => unsub();
  }, []);

  // Subscribe to reports
  useEffect(() => {
    const unsub = fbService.subscribeToReports((reps: any[]) => {
      setReports(reps.map(r => ({
        id: r.id, type: r.type, targetId: r.targetId,
        reportedBy: r.reportedBy, timestamp: r.timestamp, status: r.status
      })));
    });
    return () => unsub();
  }, []);

  // Load user-specific data from Firestore when user logs in
  useEffect(() => {
    if (!firebaseUid || !user.username) return;
    fbService.getUserProfile(firebaseUid).then((profile: any) => {
      if (!profile) return;
      // Load likedBooks
      if (profile.likedBooks) setLikedBooks(new Set(profile.likedBooks));
      else setLikedBooks(new Set());
      likedBooksInteracted.current = false;
      // Load blocked users
      if (profile.blockedUsers) setBlockedUsers(new Set(profile.blockedUsers));
      // Load avatar config
      if (profile.avatarConfig) setAllAvatarConfigs(prev => ({ ...prev, [user.username]: profile.avatarConfig }));
      // Load unlocked items
      if (profile.unlockedItems) setAllUnlockedItems(prev => ({ ...prev, [user.username]: profile.unlockedItems }));
      // Load user book data
      if (profile.ownedBookIds || profile.bookProgress || profile.purchasedBookIds) {
        setUserBookData(prev => ({
          ...prev,
          [user.username]: {
            ownedBookIds: profile.ownedBookIds || [],
            purchasedBookIds: profile.purchasedBookIds || [],
            bookProgress: profile.bookProgress || {},
          }
        }));
      }
      // Load reading activity
      if (profile.readingActivity) setReadingActivity(prev => ({ ...prev, [user.username]: profile.readingActivity }));
      // Load coupons
      if (profile.coupons) setCoupons(profile.coupons);
      // Load cart (stored as full book objects)
      if (profile.cart) setCart(profile.cart);
      // Load item price overrides
      if (profile.itemPriceOverrides) setItemPriceOverrides(profile.itemPriceOverrides);
      // Load earned points tracking + membership + chapter limits
      if (profile.dailyEarnedPoints !== undefined || profile.lastPointsReset !== undefined || profile.membershipStartDate || profile.dailyChaptersPublished !== undefined) {
        setUser(prev => ({
          ...prev,
          dailyEarnedPoints: profile.dailyEarnedPoints || 0,
          lastPointsReset: profile.lastPointsReset || null,
          membershipStartDate: profile.membershipStartDate || null,
          lastMembershipRewardDate: profile.lastMembershipRewardDate || null,
          dailyChaptersPublished: profile.dailyChaptersPublished || 0,
          lastChapterPublishReset: profile.lastChapterPublishReset || 0,
        }));
      }
      // Load last claimed points timestamp
      if (profile.lastClaimedPoints) setLastClaimedPoints(profile.lastClaimedPoints);
      // Mark user data as loaded so persist effects can start saving
      setUserDataLoaded(true);
    }).catch(console.error);
  }, [firebaseUid, user.username]);

  // Save likedBooks to Firestore after user interaction
  useEffect(() => {
    if (likedBooksInteracted.current && firebaseUid) {
      fbService.updateUserProfile(firebaseUid, { likedBooks: Array.from(likedBooks) }).catch(console.error);
    }
  }, [likedBooks]);

  // Message expiry: delete messages older than 1 year from Firestore
  useEffect(() => {
    if (!user.username) return;
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    fbService.deleteChatMessagesOlderThan(oneYearAgo.toISOString()).catch(console.error);
  }, []);

  // Mark messages as read when viewing a chat conversation (writes to Firestore)
  useEffect(() => {
    if (view === 'chat-conversation' && selectedChatUser && user.username) {
      fbService.markMessagesRead(selectedChatUser, user.username).catch(console.error);
    }
  }, [view, selectedChatUser]);

  // NOTE: Individual persist effects removed — all user data is now batched
  // into a single debounced write (see persistTimerRef effect above)
  // This reduces Firestore writes by ~8x and prevents quota exhaustion

  // Handle Stripe payment redirects and pending purchases - only after user is loaded
  useEffect(() => {
    if (view === 'splash' || view === 'login' || view === 'signup') return;
    const urlParams = new URLSearchParams(window.location.search);
    // Handle redirect with ?points_success=true
    if (urlParams.get('points_success') === 'true') {
      const pendingPoints = JSON.parse(localStorage.getItem('mainwrld_pending_points') || 'null');
      if (pendingPoints) {
        setUser(prev => ({ ...prev, points: prev.points + pendingPoints.pts }));
        showToast(`${pendingPoints.pts} points added to your account!`, 'check_circle');
        localStorage.removeItem('mainwrld_pending_points');
      }
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    // Handle premium subscription success
    if (urlParams.get('premium_success') === 'true') {
      setUser(prev => ({ ...prev, isPremium: true, premiumSince: new Date().toISOString(), membershipStartDate: Date.now() }));
      showToast('Welcome to MainWRLD+!', 'workspace_premium');
      localStorage.removeItem('mainwrld_pending_premium');
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    if (urlParams.get('payment_cancelled') === 'true') {
      showToast('Payment cancelled.', 'info');
      localStorage.removeItem('mainwrld_pending_purchase');
      localStorage.removeItem('mainwrld_pending_coupon');
      localStorage.removeItem('mainwrld_pending_points');
      localStorage.removeItem('mainwrld_pending_premium');
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    // Auto-detect pending purchase when user returns to app (no redirect needed)
    const pendingPoints = JSON.parse(localStorage.getItem('mainwrld_pending_points') || 'null');
    if (pendingPoints) {
      // Check if enough time passed (user was likely on Stripe checkout)
      const timeSinceSet = Date.now() - (pendingPoints.timestamp || 0);
      if (timeSinceSet > 5000) {
        showConfirm({
          title: 'Purchase Complete?',
          message: `Did you complete the purchase of ${pendingPoints.pts} points for $${pendingPoints.usd}?`,
          confirmLabel: 'Yes, Add Points',
          cancelLabel: 'No',
          icon: 'check_circle',
          onConfirm: () => {
            setUser(prev => ({ ...prev, points: prev.points + pendingPoints.pts }));
            showToast(`${pendingPoints.pts} points added to your account!`, 'check_circle');
            localStorage.removeItem('mainwrld_pending_points');
          },
          onCancel: () => {
            localStorage.removeItem('mainwrld_pending_points');
          },
        });
      }
    }
    // Auto-detect pending premium subscription
    const pendingPremium = JSON.parse(localStorage.getItem('mainwrld_pending_premium') || 'null');
    if (pendingPremium) {
      const timeSinceSet = Date.now() - (pendingPremium.timestamp || 0);
      if (timeSinceSet > 5000) {
        showConfirm({
          title: 'Subscription Complete?',
          message: 'Did you complete the MainWRLD Premium subscription?',
          confirmLabel: 'Yes, Activate',
          cancelLabel: 'No',
          icon: 'workspace_premium',
          onConfirm: () => {
            setUser(prev => ({ ...prev, isPremium: true, premiumSince: new Date().toISOString(), membershipStartDate: Date.now() }));
            showToast('Welcome to MainWRLD+!', 'workspace_premium');
            localStorage.removeItem('mainwrld_pending_premium');
          },
          onCancel: () => {
            localStorage.removeItem('mainwrld_pending_premium');
          },
        });
      }
    }
  }, [view]);

  // Firebase Auth state listener - handles auto-login
  useEffect(() => {
    const timer = setTimeout(() => {
      const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          try {
            const profile = await fbService.getUserProfile(firebaseUser.uid);
            if (profile) {
              setUser({
                username: (profile as any).username,
                displayName: (profile as any).displayName,
                isOnline: true,
                activity: 'Idle',
                position: [0, 0, 0],
                isMutual: false,
                points: (profile as any).points || 0,
                admirersCount: (profile as any).admirersCount || 0,
                mutualsCount: (profile as any).mutualsCount || 0,
                strikes: (profile as any).strikes || 0,
                isPremium: (profile as any).isPremium || false,
                admiringCount: (profile as any).admiringCount || 0,
              });
              setFirebaseUid(firebaseUser.uid);
              setView('home');
              // Mark user online in Firestore on auth restore
              fbService.updateUserProfile(firebaseUser.uid, { isOnline: true, lastOnline: new Date().toISOString() }).catch(console.error);
            } else {
              setView('login');
            }
          } catch {
            setView('login');
          }
        } else {
          setView('login');
        }
        setAuthLoading(false);
      });
      return () => unsubscribe();
    }, 1500); // Keep splash screen delay
    return () => clearTimeout(timer);
  }, []);

  const addNotification = useCallback((title: string, message: string, icon: string, recipient?: string, sender?: string) => {
    const newNotif = {
      id: Math.random().toString(36).substr(2, 9),
      title,
      message,
      icon,
      timestamp: new Date().toISOString(),
      recipient: recipient || user.username,
      sender: sender || user.username,
      read: false,
    };
    fbService.addNotificationDoc(newNotif).catch(console.error);
  }, [user.username]);

  const handleLogout = async () => {
    // Mark offline in Firestore before logging out
    if (firebaseUid) {
      await fbService.updateUserProfile(firebaseUid, { isOnline: false, lastOnline: new Date().toISOString() }).catch(console.error);
    }
    try {
      await fbService.logOut();
    } catch {}
    setUser(BLANK_USER);
    setFirebaseUid(null);
    setUserDataLoaded(false);
    setView('login');
  };

  const handleLogin = async () => {
    try {
      const result = await fbService.logIn(loginForm.username, loginForm.password);
      setUser({
        username: (result as any).username,
        displayName: (result as any).displayName,
        isOnline: true,
        activity: 'Idle',
        position: [0, 0, 0],
        isMutual: false,
        points: (result as any).points || 0,
        admirersCount: (result as any).admirersCount || 0,
        mutualsCount: (result as any).mutualsCount || 0,
        strikes: (result as any).strikes || 0,
        isPremium: (result as any).isPremium || false,
        admiringCount: (result as any).admiringCount || 0,
      });
      setFirebaseUid((result as any).uid);
      setAuthError(null);
      setView('home');
      // Mark user online in Firestore
      fbService.updateUserProfile((result as any).uid, { isOnline: true, lastOnline: new Date().toISOString() }).catch(console.error);
    } catch (err: any) {
      setAuthError(err.message || 'Invalid username or password.');
    }
  };

  const handleSignup = async () => {
    const { username, displayName, password, email } = signUpForm;

    // Validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setAuthError('Please enter a valid email address.');
      return;
    }
    const usernameRegex = /^[a-z0-9_]{5,25}$/;
    if (!usernameRegex.test(username)) {
      setAuthError('Username must be 5-25 chars, lowercase, no spaces.');
      return;
    }
    if (displayName.length < 5 || displayName.length > 25) {
      setAuthError('Display Name must be 5-25 characters.');
      return;
    }
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,35}$/;
    if (!passwordRegex.test(password)) {
      setAuthError('Password must be 12-35 characters and include at least one uppercase letter, one number, and one symbol.');
      return;
    }
    if (containsBadWord(username) || containsBadWord(displayName)) {
      setAuthError('Username or display name contains inappropriate language.');
      return;
    }

    // Check username uniqueness via Firestore
    try {
      const usernameAvailable = await fbService.checkUsernameAvailable(username);
      if (!usernameAvailable) {
        setAuthError('Username already taken.');
        return;
      }
    } catch {
      setAuthError('Unable to check username. Please try again.');
      return;
    }

    try {
      const result = await fbService.signUp(email, password, username, displayName, signUpForm.birthDate);

      const newUser: User = {
        username,
        displayName,
        isOnline: true,
        activity: 'Idle',
        position: [0, 0, 0],
        isMutual: false,
        points: 50,
        admirersCount: 0,
        mutualsCount: 0,
        strikes: 0,
      };

      setUser(newUser);
      setFirebaseUid(result.uid);
      setAuthError(null);
      setView('home');

      // Refresh registered users list
      fbService.getAllUsers().then((users: any[]) => setRegisteredUsers(users)).catch(console.error);

      // Send welcome email asynchronously (non-blocking)
      if (email) {
        sendWelcomeEmail(email, displayName, username);
      }
      addNotification('Welcome to MainWRLD!', `Hey ${displayName}, start exploring stories and connecting with other readers!`, 'celebration', username);
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setAuthError('An account with this email already exists.');
      } else {
        setAuthError(err.message || 'Signup failed. Please try again.');
      }
    }
  };

  const handleSendMessage = (toUsername: string, text: string) => {
    if (!text.trim()) return;
    if (containsBadWord(text)) {
      showToast('Your message contains inappropriate language.', 'warning');
      return;
    }
    // Write to Firestore — real-time subscription will update local state
    fbService.sendChatMessage(user.username, toUsername, text.trim()).catch(console.error);
    // Send notification to recipient
    const recipientUser = registeredUsers.find(u => u.username === toUsername) || MUTUALS.find(u => u.username === toUsername);
    if (recipientUser) {
      addNotification('New Message', `${user.displayName}: ${text.trim().slice(0, 50)}${text.length > 50 ? '...' : ''}`, 'chat', toUsername);
    }
  };

  const handleLike = async (bookId: string, chapterIndex: number = 0) => {
    likedBooksInteracted.current = true;
    const likeKey = `${bookId}:${chapterIndex}`;
    const isLiked = likedBooks.has(likeKey);

    const targetBook = books.find(b => b.id === bookId);
    if (!targetBook) return;

    const chLikes = getChapterLikes(targetBook.likes, (targetBook.chapters?.length || 1));

    if (isLiked) {
      const next = new Set(likedBooks);
      next.delete(likeKey);
      setLikedBooks(next);
      chLikes[chapterIndex] = Math.max(0, (chLikes[chapterIndex] || 0) - 1);
    } else {
      const next = new Set(likedBooks);
      next.add(likeKey);
      setLikedBooks(next);
      chLikes[chapterIndex] = (chLikes[chapterIndex] || 0) + 1;
      const chapterTitle = targetBook.chapters?.[chapterIndex]?.title || `Chapter ${chapterIndex + 1}`;
      addNotification('Chapter Liked', `${user?.displayName} liked ${chapterTitle} from "${targetBook.title}"`, 'favorite', targetBook.author.username);

      // Earned points: award book author 2 pts when chapter hits like threshold
      const rewardKey = `chapter:${bookId}:${chapterIndex}:${Math.floor(chLikes[chapterIndex] / CHAPTER_LIKES_THRESHOLD)}`;
      if (chLikes[chapterIndex] % CHAPTER_LIKES_THRESHOLD === 0 && !rewardedItems.has(rewardKey) && targetBook.author.username === user.username) {
        setRewardedItems(prev => new Set(prev).add(rewardKey));
        awardPoints(2, `${chapterTitle} hit ${chLikes[chapterIndex]} likes!`);
      }
    }

    // Update locally for immediate UI feedback
    setBooks(prev => prev.map(b => {
      if (b.id !== bookId) return b;
      const updated = { ...b, likes: [...chLikes] };
      if (selectedBook && selectedBook.id === bookId) setSelectedBook(updated);
      return updated;
    }));

    // Persist to Firestore
    fbService.updateBook(bookId, { likes: chLikes }).catch(console.error);
  };

  const handleAdmire = (targetUser: User) => {
    const admireKey = `${user.username}->${targetUser.username}`;

    // Prevent rapid double-clicks while Firestore is updating
    if (pendingAdmireRef.current.has(admireKey)) return;

    const alreadyAdmiring = relationships.some(r => r.admirer === user.username && r.target === targetUser.username);

    if (alreadyAdmiring) {
      // Check if they are mutuals before un-admiring
      const isMutual = relationships.some(r => r.admirer === targetUser.username && r.target === user.username);
      if (isMutual) {
        showConfirm({
          title: 'Stop being mutuals?',
          message: `You and ${targetUser.displayName} will no longer be mutuals. Chat will be disabled but previous messages will be saved as read-only.`,
          confirmLabel: 'Yes, stop admiring',
          cancelLabel: 'Cancel',
          icon: 'people_outline',
          onConfirm: () => {
            pendingAdmireRef.current.add(admireKey);
            // Optimistic local update: remove relationship
            setRelationships(prev => prev.filter(r => !(r.admirer === user.username && r.target === targetUser.username)));
            fbService.removeRelationship(user.username, targetUser.username)
              .catch(console.error)
              .finally(() => pendingAdmireRef.current.delete(admireKey));
            showToast('You are no longer mutuals', 'people_outline');
          },
          onCancel: () => {}
        });
      } else {
        // Not mutuals, just un-admire silently
        pendingAdmireRef.current.add(admireKey);
        setRelationships(prev => prev.filter(r => !(r.admirer === user.username && r.target === targetUser.username)));
        fbService.removeRelationship(user.username, targetUser.username)
          .catch(console.error)
          .finally(() => pendingAdmireRef.current.delete(admireKey));
        showToast('Stopped admiring', 'person_remove');
      }
      return;
    }

    // Lock to prevent duplicate clicks
    pendingAdmireRef.current.add(admireKey);

    // Optimistic local update: add relationship immediately
    setRelationships(prev => [...prev, { admirer: user.username, target: targetUser.username, timestamp: new Date().toISOString() }]);

    // Add admire relationship to Firestore
    fbService.addRelationship(user.username, targetUser.username)
      .catch(console.error)
      .finally(() => pendingAdmireRef.current.delete(admireKey));

    // Notify the target user they have a new admirer
    addNotification('New Admirer', `${user.displayName} is now admiring you!`, 'person_add', targetUser.username);

    // Check if this creates a mutual (target already admires current user)
    // Use local state first, then fall back to Firestore query for reliability
    const targetAdmiresLocal = relationships.some(r => r.admirer === targetUser.username && r.target === user.username);
    if (targetAdmiresLocal) {
      addNotification('Mutual Connection!', `You and ${targetUser.displayName} are now mutuals!`, 'people', user.username);
      addNotification('Mutual Connection!', `You and ${user.displayName} are now mutuals!`, 'people', targetUser.username);
    } else {
      // Firestore fallback: local relationships state might not have the reverse relationship yet
      fbService.checkRelationshipExists(targetUser.username, user.username).then(exists => {
        if (exists) {
          addNotification('Mutual Connection!', `You and ${targetUser.displayName} are now mutuals!`, 'people', user.username);
          addNotification('Mutual Connection!', `You and ${user.displayName} are now mutuals!`, 'people', targetUser.username);
        }
      }).catch(console.error);
    }
  };

  const handleReport = (type: 'Book' | 'Comment' | 'User', targetId: string) => {
    const newReport = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      targetId,
      reportedBy: user.username,
      timestamp: new Date().toISOString(),
      status: 'pending',
    };
    fbService.addReportDoc(newReport).catch(console.error);
    addNotification('Report Filed', `Your report for ${type.toLowerCase()} has been submitted.`, 'flag');
    showToast(`${type} reported successfully!`, 'flag');
  };

  const handleRemoveBook = (bookId: string) => {
    fbService.deleteBook(bookId).catch(console.error);
    reports.filter(r => r.targetId === bookId && r.type === 'Book').forEach(r => {
      fbService.updateReportStatus(r.id, 'resolved').catch(console.error);
    });
  };

  const handleRemoveComment = (commentId: string) => {
    fbService.removeCommentDoc(commentId).catch(console.error);
    // Resolve any reports for this comment
    reports.filter(r => r.targetId === commentId && r.type === 'Comment').forEach(r => {
      fbService.updateReportStatus(r.id, 'resolved').catch(console.error);
    });
  };

  const handleAddStrike = (username: string) => {
    const targetUser = registeredUsers.find(u => u.username === username);
    if (targetUser?.uid) {
      fbService.updateUserProfile(targetUser.uid, { strikes: (targetUser.strikes || 0) + 1 }).catch(console.error);
    }
    setRegisteredUsers(prev => prev.map(u =>
      u.username === username ? { ...u, strikes: (u.strikes || 0) + 1 } : u
    ));
  };

  const handleRemoveStrike = (username: string) => {
    const targetUser = registeredUsers.find(u => u.username === username);
    if (targetUser?.uid && targetUser.strikes > 0) {
      fbService.updateUserProfile(targetUser.uid, { strikes: targetUser.strikes - 1 }).catch(console.error);
    }
    setRegisteredUsers(prev => prev.map(u =>
      u.username === username && u.strikes > 0 ? { ...u, strikes: u.strikes - 1 } : u
    ));
  };

  const handleBanUser = (username: string) => {
    // Remove user's comments from Firestore
    fbService.removeCommentsByAuthor(username).catch(console.error);
    // Remove user's relationships from Firestore
    fbService.removeAllRelationshipsForUser(username).catch(console.error);
    // Resolve reports for this user
    reports.filter(r => r.targetId === username && r.type === 'User').forEach(r => {
      fbService.updateReportStatus(r.id, 'resolved').catch(console.error);
    });
    // Delete user's books from Firestore
    books.filter(b => b.author.username === username).forEach(b => {
      fbService.deleteBook(b.id).catch(console.error);
    });
    // Note: User account deletion from Firebase Auth would require admin SDK
    // For now, just update their profile with a banned flag
    const bannedUser = registeredUsers.find(u => u.username === username);
    if (bannedUser?.uid) {
      fbService.updateUserProfile(bannedUser.uid, { isBanned: true }).catch(console.error);
    }
    setRegisteredUsers(prev => prev.filter(u => u.username !== username));
  };

  const handleDismissReport = (reportId: string) => {
    fbService.updateReportStatus(reportId, 'dismissed').catch(console.error);
  };

  const handleBlockUser = (targetUsername: string) => {
    if (targetUsername === user.username) return; // Can't block yourself
    setBlockedUsers(prev => new Set([...prev, targetUsername]));
    // Remove any admire relationships in both directions via Firestore
    fbService.removeRelationshipsBetween(user.username, targetUsername).catch(console.error);
    addNotification('User Blocked', `You blocked @${targetUsername}. You will no longer see their content.`, 'block');
    setView('home');
  };

  const handleUnblockUser = (targetUsername: string) => {
    setBlockedUsers(prev => {
      const next = new Set(prev);
      next.delete(targetUsername);
      return next;
    });
  };

  const handleSaveToLibrary = (bookId: string) => {
    setBooks(prev => {
      const updated = prev.map(b => b.id === bookId ? { ...b, isOwned: true } : b);
      // Sync selectedBook if currently looking at this book's details
      const updatedBook = updated.find(b => b.id === bookId);
      if (updatedBook && selectedBook && selectedBook.id === bookId) setSelectedBook(updatedBook);
      return updated;
    });
    setUserOwnsBook(bookId);
    showToast('Book saved to your library!', 'bookmark');
    // Immediately persist library change to Firestore (don't rely on debounce)
    if (firebaseUid) {
      const ud = userBookData[user.username] || { ownedBookIds: [], bookProgress: {}, purchasedBookIds: [] };
      const updatedOwned = ud.ownedBookIds.includes(bookId) ? ud.ownedBookIds : [...ud.ownedBookIds, bookId];
      const updatedPurchased = (ud as any).purchasedBookIds || [];
      fbService.updateUserProfile(firebaseUid, {
        ownedBookIds: updatedOwned,
        purchasedBookIds: updatedPurchased.includes(bookId) ? updatedPurchased : [...updatedPurchased, bookId],
      }).catch(console.error);
    }
  };

  const handleRemoveFromLibrary = (bookId: string) => {
    setBooks(prev => {
      const updated = prev.map(b => b.id === bookId ? { ...b, isOwned: false } : b);
      // Sync selectedBook if currently looking at this book's details
      const updatedBook = updated.find(b => b.id === bookId);
      if (updatedBook && selectedBook && selectedBook.id === bookId) setSelectedBook(updatedBook);
      return updated;
    });
    setUserBookData(prev => {
      const ud = { ...(prev[user.username] || { ownedBookIds: [], bookProgress: {}, purchasedBookIds: [] }) };
      ud.ownedBookIds = ud.ownedBookIds.filter((id: string) => id !== bookId);
      if (ud.purchasedBookIds) ud.purchasedBookIds = ud.purchasedBookIds.filter((id: string) => id !== bookId);
      return { ...prev, [user.username]: ud };
    });
    showToast('Book removed from your library.', 'bookmark_remove');
    // Immediately persist removal to Firestore
    if (firebaseUid) {
      const ud = userBookData[user.username] || { ownedBookIds: [], bookProgress: {}, purchasedBookIds: [] };
      fbService.updateUserProfile(firebaseUid, {
        ownedBookIds: ud.ownedBookIds.filter((id: string) => id !== bookId),
        purchasedBookIds: ((ud as any).purchasedBookIds || []).filter((id: string) => id !== bookId),
      }).catch(console.error);
    }
  };

  const isBookInLibrary = useCallback((bookId: string): boolean => {
    const userData = userBookData[user.username] || { ownedBookIds: [], bookProgress: {} };
    return userData.ownedBookIds.includes(bookId);
  }, [userBookData, user.username]);

  const handleToggleFavorite = (bookId: string) => {
    setBooks(prev => {
      const newBooks = prev.map(b => b.id === bookId ? { ...b, isFavorite: !b.isFavorite } : b);
      const updatedBook = newBooks.find(b => b.id === bookId);
      if (updatedBook && selectedBook && selectedBook.id === bookId) setSelectedBook(updatedBook);
      return newBooks;
    });
  };

  const handleAddToCart = (book: Book) => {
    if (cart.find(item => item.id === book.id)) {
      showToast('Book is already in your cart!', 'info');
      return;
    }
    setCart([...cart, book]);
    showToast('Book added to cart!', 'shopping_cart');
  };

  const awardPoints = (amount: number, reason: string) => {
    const now = Date.now();
    const isNewDay = !user.lastPointsReset || (now - (user.lastPointsReset || 0) > 24 * 60 * 60 * 1000);
    const currentDaily = isNewDay ? 0 : (user.dailyEarnedPoints || 0);
    if (currentDaily >= MAX_DAILY_EARNED_POINTS) return;
    const finalAmount = Math.min(amount, MAX_DAILY_EARNED_POINTS - currentDaily);
    if (finalAmount <= 0) return;
    setUser(prev => {
      const isStillNewDay = !prev.lastPointsReset || (now - (prev.lastPointsReset || 0) > 24 * 60 * 60 * 1000);
      const prevDaily = isStillNewDay ? 0 : (prev.dailyEarnedPoints || 0);
      return {
        ...prev,
        points: prev.points + finalAmount,
        dailyEarnedPoints: prevDaily + finalAmount,
        lastPointsReset: isStillNewDay ? now : prev.lastPointsReset,
      };
    });
    showToast(`+${finalAmount} points — ${reason}`, 'emoji_events');
  };

  const handleClaimPoints = () => {
    const now = Date.now();
    if (lastClaimedPoints && now - lastClaimedPoints < 24 * 60 * 60 * 1000) {
      const nextAvailable = new Date(lastClaimedPoints + 24 * 60 * 60 * 1000);
      showToast(`You can claim points again at ${nextAvailable.toLocaleTimeString()}`, 'schedule');
      return;
    }
    const pts = user.isPremium ? 6 : 3;
    awardPoints(pts, user.isPremium ? 'Daily claim (2x Premium bonus)' : 'Daily claim');
    setLastClaimedPoints(now);
  };

const handleSpinWheel = () => {
  if (user.points < 150) {
    showToast("You need 150 points to win a coupon", 'info');
    return;
  }

  const unusedCoupons = coupons.filter((c: Coupon) => !c.used);

  const proceedWithSpin = () => {
    // Deduct points
    setUser(prev => ({
      ...prev,
      points: prev.points - 150
    }));

    // Random Chancing
    const rand = Math.random() * 100;
    let winValue = 1;
    if (rand < 84) {
      winValue = 1;
    } else if (rand < 93) {
      winValue = 3;
    } else if (rand < 98) {
      winValue = 5;
    } else {
      winValue = 10;
    }

    const newCoupon: Coupon = {
      id: Math.random().toString(36).substr(2, 9),
      value: winValue,
      used: false
    };

    setCoupons(prev => {
      const unusedOnly = prev.filter((c: Coupon) => !c.used);

      if (unusedOnly.length >= 3) {
        unusedOnly.shift(); // Remove oldest unused (FIFO)
      }

      return [...unusedOnly, newCoupon];
    });

    showToast(`You won a $${winValue} coupon!`, 'confirmation_number');
  };

  // If slots full → ask confirmation and STOP execution
  if (unusedCoupons.length >= 3) {
    const oldestUnused = unusedCoupons[0];

    showConfirm({
      title: 'Your coupon slots are full (3/3)',
      message: `Winning a new coupon will permanently eliminate your oldest ticket ($${oldestUnused.value}). Do you wish to proceed?`,
      confirmLabel: 'Yes',
      cancelLabel: 'No',
      icon: 'check_circle',
      onConfirm: proceedWithSpin,
      onCancel: () => {
      }
    });

    return; // stop execution here
  }

  // If slots not full then proceed immediately
  proceedWithSpin();
};


  // Membership reward: 200 pts after 25hrs of premium, then annually
  useEffect(() => {
    if (!user.isPremium || !user.membershipStartDate) return;
    const checkMembershipReward = () => {
      const now = Date.now();
      const msInYear = 365 * 24 * 60 * 60 * 1000;
      const msIn25Hours = 25 * 60 * 60 * 1000;
      if (!user.lastMembershipRewardDate) {
        if (now - user.membershipStartDate >= msIn25Hours) {
          awardPoints(200, "Membership Reward");
          setUser(prev => ({ ...prev, lastMembershipRewardDate: now }));
        }
      } else {
        if (now - user.lastMembershipRewardDate >= msInYear) {
          awardPoints(200, "Annual Membership Reward");
          setUser(prev => ({ ...prev, lastMembershipRewardDate: now }));
        }
      }
    };
    const interval = setInterval(checkMembershipReward, 60000);
    checkMembershipReward();
    return () => clearInterval(interval);
  }, [user.isPremium, user.membershipStartDate, user.lastMembershipRewardDate]);

  const handlePublish = async (data: any) => {
    try {
    // Daily chapter publish limit
    const now = Date.now();
    const isNewDay = now - user.lastChapterPublishReset > 24 * 60 * 60 * 1000;
    const dailyCount = isNewDay ? 0 : user.dailyChaptersPublished;
    if (dailyCount >= MAX_DAILY_CHAPTERS) {
      showToast(`You've reached your daily publishing limit of ${MAX_DAILY_CHAPTERS} chapters. Please try again tomorrow!`);
      return;
    }
    if (containsBadWord(data.title || '') || containsBadWord(data.tagline || '')) {
      showToast('Your content contains inappropriate language. Please revise before publishing.', 'warning');
      return;
    }
    if (currentPublishingId) {
      // Update existing book - preserve existing metadata when just adding/updating chapters
      const existingBook = books.find(b => b.id === currentPublishingId);
      if (existingBook) {
        const updatedChapters = [...(existingBook.chapters || [])];
        const targetIndex = currentPublishingChapterIndex !== null ? currentPublishingChapterIndex : updatedChapters.length - 1;

        if (targetIndex >= 0 && targetIndex < updatedChapters.length) {
          updatedChapters[targetIndex] = { ...updatedChapters[targetIndex], content: currentPublishingContent };
        } else {
          updatedChapters.push({ title: `Chapter ${updatedChapters.length + 1}`, content: currentPublishingContent });
        }

        const updatedLikes = (() => { const arr = Array.isArray(existingBook.likes) ? [...existingBook.likes] : [existingBook.likes || 0]; while (arr.length < updatedChapters.length) arr.push(0); return arr; })();

        await fbService.updateBook(currentPublishingId, {
          tagline: data.tagline || existingBook.tagline || '',
          isExplicit: data.isExplicit ?? existingBook.isExplicit ?? false,
          genres: (data.genres && data.genres.length > 0) ? data.genres : (existingBook.genres || []),
          hashtags: (data.hashtags && data.hashtags.length > 0) ? data.hashtags : (existingBook.hashtags || []),
          coverImage: data.coverImage || existingBook.coverImage || null,
          coverColor: data.coverImage ? '#f5f5f5' : (existingBook.coverColor || '#' + Math.floor(Math.random()*16777215).toString(16)),
          chapters: updatedChapters,
          chaptersCount: Math.max(existingBook.chaptersCount || 0, (targetIndex + 1)),
          likes: updatedLikes,
          isDraft: false,
          commentsEnabled: data.commentsEnabled ?? true,
          content: updatedChapters.map((c: any) => c.content).join('\n\n')
        });

        // Notify users who have this book in their library about the new chapter
        if (currentPublishingChapterIndex === null || (existingBook.chapters && currentPublishingChapterIndex >= existingBook.chapters.length)) {
          Object.entries(userBookData).forEach(([username, udata]: [string, any]) => {
            if (username !== user?.username && udata.ownedBookIds?.includes(currentPublishingId)) {
              addNotification('New Chapter', `"${existingBook.title}" has a new chapter!`, 'menu_book', username, user?.username);
            }
          });
        }
      }
    } else {
      // New book — write to Firestore
      const bookData = {
        title: currentPublishingTitle,
        authorUid: firebaseUid || '',
        authorUsername: user?.username || '',
        authorDisplayName: user?.displayName || '',
        coverColor: data.coverImage ? '#f5f5f5' : '#' + Math.floor(Math.random()*16777215).toString(16),
        coverImage: data.coverImage || null,
        likes: [0],
        commentsCount: 0,
        monetizationAttempts: 0,
        publishedDate: new Date().toISOString().split('T')[0],
        isCompleted: false,
        isExplicit: data.isExplicit ?? false,
        chaptersCount: 1,
        tagline: data.tagline || '',
        genres: data.genres || [],
        hashtags: data.hashtags || [],
        content: currentPublishingContent,
        isDraft: false,
        commentsEnabled: data.commentsEnabled ?? true,
        chapters: [{ title: 'Chapter 1', content: currentPublishingContent }],
        isFree: true,
        price: 0
      };
      await fbService.createBook(bookData);

      // Notify admirers and mutuals about the new book
      const myAdmirers = relationships.filter(r => r.target === user?.username).map(r => r.admirer);
      const myAdmiring = relationships.filter(r => r.admirer === user?.username).map(r => r.target);
      const notifyUsers = new Set([...myAdmirers, ...myAdmiring]);
      notifyUsers.forEach(username => {
        if (username !== user?.username) {
          addNotification('New Book', `${user?.displayName} published a new book: "${currentPublishingTitle}"`, 'auto_stories', username, user?.username);
        }
      });
    }
    setView('self-profile');
    setCurrentPublishingContent('');
    setCurrentPublishingTitle('');
    setCurrentPublishingId(null);
    setCurrentPublishingChapterIndex(null);
    setPublishingInitialData(null);
    showToast('Published successfully!', 'check_circle');
    // Increment daily chapter publish count
    setUser(prev => {
      const isNewDay = Date.now() - prev.lastChapterPublishReset > 24 * 60 * 60 * 1000;
      return {
        ...prev,
        dailyChaptersPublished: (isNewDay ? 0 : prev.dailyChaptersPublished) + 1,
        lastChapterPublishReset: isNewDay ? Date.now() : prev.lastChapterPublishReset
      };
    });
    } catch (err: any) {
      console.error('Publish error:', err);
      showToast('Failed to publish. Please try again.', 'error');
    }
  };

  const handleUnpublish = async (bookId: string) => {
    const book = books.find(b => b.id === bookId);
    const wasMonetized = book?.isMonetized;
    await fbService.updateBook(bookId, {
      isDraft: true,
      isMonetized: false,
      wasMonetizedBefore: wasMonetized || book?.wasMonetizedBefore || false
    });
    showToast('Book unpublished and moved to drafts.', 'visibility_off');
  };

  const handleDeleteBook = (bookId: string) => {
    showConfirm({
      title: 'This action cannot be undone.',
      message: `Are you sure you want to permanently delete this book?`,
      confirmLabel: 'Yes',
      cancelLabel: 'No',
      icon: 'check_circle',
      onConfirm: async () => {
        await fbService.deleteBook(bookId);
        setView('self-profile');
        showToast(`You successfully deleted your book`);
      },
      onCancel: () => {}
    });
  };

  const handleMarkCompleted = (bookId: string) => {
    const book = books.find(b => b.id === bookId);
    if (!book) return;

    if (book.isCompleted) {
      if (book.isMonetized) {
        showConfirm({
          title: 'Warning: Demonetization',
          message: 'This book is currently monetized. Marking it as uncomplete will permanently demonetize it and it cannot be monetized again. Are you sure?',
          confirmLabel: 'Yes, demonetize and reopen',
          cancelLabel: 'Cancel',
          icon: 'money_off',
          onConfirm: async () => {
            const updates = { isCompleted: false, wasCompleted: true, isMonetized: false, wasMonetizedBefore: true, isFree: true, price: 0 };
            await fbService.updateBook(bookId, updates);
            if (selectedBook?.id === bookId) setSelectedBook((prev: any) => prev ? { ...prev, ...updates } : prev);
            showToast('Book demonetized and reopened', 'money_off');
          },
          onCancel: () => {}
        });
      } else {
        showConfirm({
          title: 'Reopen this work?',
          message: 'This will remove the completed status. The book will become editable again.',
          confirmLabel: 'Reopen',
          cancelLabel: 'Cancel',
          icon: 'undo',
          onConfirm: async () => {
            const updates = { isCompleted: false, wasCompleted: true };
            await fbService.updateBook(bookId, updates);
            if (selectedBook?.id === bookId) setSelectedBook((prev: any) => prev ? { ...prev, ...updates } : prev);
            showToast('Completed status removed', 'undo');
          },
          onCancel: () => {}
        });
      }
    } else {
      showConfirm({
        title: 'Mark as Completed?',
        message: 'Once marked completed, this book will become un-editable. Are you sure?',
        confirmLabel: 'Yes, Complete',
        cancelLabel: 'Cancel',
        icon: 'check_circle',
        onConfirm: async () => {
          const updates = { isCompleted: true, wasCompleted: true };
          await fbService.updateBook(bookId, updates);
          if (selectedBook?.id === bookId) setSelectedBook((prev: any) => prev ? { ...prev, ...updates } : prev);
          showToast('Book marked as completed!', 'check_circle');
        },
        onCancel: () => {}
      });
    }
  };

  const handleRequestMonetization = async (bookId: string) => {
    const book = books.find(b => b.id === bookId);
    await fbService.updateBook(bookId, { monetizationAttempts: (book?.monetizationAttempts || 0) + 1 });
  };

  const handleSaveDraft = (bookId: string | null, title: string, content: string, chapterIndex: number | null): string | null => {
    if (!title.trim() && !bookId) return null;
    let newBookId = bookId;
    if (bookId) {
      // Update existing draft in Firestore
      const existingBook = books.find(b => b.id === bookId);
      if (existingBook) {
        const updatedChapters = [...(existingBook.chapters || [])];
        if (chapterIndex !== null && chapterIndex >= 0 && chapterIndex < updatedChapters.length) {
          updatedChapters[chapterIndex] = { ...updatedChapters[chapterIndex], content };
        } else if (content.trim()) {
          updatedChapters.push({ title: `Chapter ${updatedChapters.length + 1}`, content });
        }
        fbService.updateBook(bookId, {
          title: title.trim() || existingBook.title,
          chapters: updatedChapters,
          content: updatedChapters.map((c: any) => c.content).join('\n\n')
        }).catch(console.error);
      }
      return bookId;
    } else {
      const existingDraft = books.find((b: Book) => b.isDraft && b.title === title.trim() && b.author.username === user?.username);
      if (existingDraft) {
        newBookId = existingDraft.id;
        const updatedChapters = content.trim() ? [{ title: 'Chapter 1', content }] : [];
        fbService.updateBook(existingDraft.id, { content, chapters: updatedChapters }).catch(console.error);
      } else {
        // Create new draft in Firestore
        const bookData = {
          title: title.trim(),
          authorUid: firebaseUid || '',
          authorUsername: user?.username || '',
          authorDisplayName: user?.displayName || '',
          coverColor: '#' + Math.floor(Math.random()*16777215).toString(16),
          likes: [0],
          commentsCount: 0,
          publishedDate: new Date().toISOString().split('T')[0],
          isCompleted: false,
          isDraft: true,
          isExplicit: false,
          chaptersCount: content.trim() ? 1 : 0,
          tagline: '',
          genres: [],
          hashtags: [],
          content,
          chapters: content.trim() ? [{ title: 'Chapter 1', content }] : []
        };
        // Create async and return a temp id — the real-time listener will update with the Firestore id
        fbService.createBook(bookData).then((created: any) => {
          newBookId = created.id;
        }).catch(console.error);
        // Return null for now since we don't have the id yet synchronously
        return null;
      }
    }
    // Sync current editing state
    setLastSelectedBookId(newBookId || 'new');
    setLastSelectedChapterIndex(chapterIndex !== null ? chapterIndex.toString() : 'new');
    return newBookId;
  };


  const postComment = (text: string, chapterIndex?: number) => {
  if (selectedBook?.commentsEnabled === false) {
    showToast("Comments Disabled");
    return;
  }
  if (containsBadWord(text)) {
    showToast('Your comment contains inappropriate language.', 'warning');
    return;
  }

  const newComment = {
    id: Math.random().toString(36).substr(2, 9),
    bookId: selectedBook.id,
    chapterIndex,
    author: user.displayName,
    authorUsername: user.username,
    text,
    likes: 0,
    likedBy: [] as string[],
    timestamp: new Date().toISOString()
  };

  fbService.addCommentDoc(newComment).catch(console.error);

  const chapterName = chapterIndex !== undefined && selectedBook.chapters?.[chapterIndex]
    ? ` (${selectedBook.chapters[chapterIndex].title})`
    : '';
  addNotification(
    'New Comment',
    `${user.displayName} commented on "${selectedBook.title}"${chapterName}`,
    'chat_bubble',
    selectedBook.author.username
  );

  showToast("Your comment has been successfully added.",
  );
};


  const handleLikeComment = (commentId: string) => {
      const comment = allComments.find(c => c.id === commentId);
      if (!comment) return;
      const likedBy = comment.likedBy || [];
      if (likedBy.includes(user.username)) return; // Already liked
      const newLikes = comment.likes + 1;
      fbService.updateComment(commentId, {
        likes: newLikes,
        likedBy: [...likedBy, user.username]
      }).catch(console.error);
      const recipientUsername = (comment as any).authorUsername || comment.author;
      addNotification('Comment Liked', `${user.displayName} liked your comment: "${comment.text.substring(0, 20)}..."`, 'favorite_border', recipientUsername);

      // Earned points: award comment author 1 pt when comment hits like threshold
      const rewardKey = `comment:${commentId}:${Math.floor(newLikes / COMMENT_LIKES_THRESHOLD)}`;
      if (newLikes % COMMENT_LIKES_THRESHOLD === 0 && !rewardedItems.has(rewardKey) && recipientUsername === user.username) {
        setRewardedItems(prev => new Set(prev).add(rewardKey));
        awardPoints(1, `Your comment hit ${newLikes} likes!`);
      }
  };

  const handleBookProgressUpdate = (bookId: string, scrollProgress: number, chapterIndex: number) => {
      // Save progress per-user (both scroll position and chapter index)
      setUserBookProgress(bookId, scrollProgress, chapterIndex);
      // Update reading activity
      setReadingActivity(prev => {
        const userActivity = [...(prev[user.username] || [])];
        const existing = userActivity.findIndex(a => a.bookId === bookId);
        if (existing >= 0) userActivity[existing] = { bookId, progress: scrollProgress, lastRead: new Date().toISOString() };
        else userActivity.unshift({ bookId, progress: scrollProgress, lastRead: new Date().toISOString() });
        return { ...prev, [user.username]: userActivity.slice(0, 10) };
      });
  };

  const handleShareBook = async (book: Book) => {
      if (navigator.share) {
          try {
              await navigator.share({
                  title: book.title,
                  text: book.tagline,
                  url: window.location.href,
              });
          } catch (err) {
              console.log('Share failed', err);
          }
      } else {
          navigator.clipboard.writeText(window.location.href);
          addNotification('Link Copied', 'Link copied to clipboard!', 'content_copy');
      }
  };

  const renderView = () => {
    switch (view) {
      case 'splash':
        return (
          <div className="fixed inset-0 bg-white flex flex-col items-center justify-center animate-in fade-in duration-700">
            <img src={`${BASE}logo.png`} alt="MainWRLD" className="w-24 h-24 mb-4" />
            <img src={`${BASE}wordlogo.png`} alt="MainWRLD" className="h-8" />
          </div>
        );

      case 'login':
        return (
          <div className="fixed inset-0 bg-white p-8 flex flex-col items-center justify-center animate-in fade-in duration-500">
            <img src={`${BASE}logo.png`} alt="MainWRLD" className="w-20 h-20 mb-4" />
            <h1 className="text-3xl font-display mb-12">Log In</h1>
            <div className="w-full max-w-sm space-y-4 mb-4">
              <Input label="Username or Email" placeholder="Enter username or email..." value={loginForm.username} onChange={(val: string) => setLoginForm({...loginForm, username: val})} />
              <Input label="Password" type="password" placeholder="••••••••••••" value={loginForm.password} onChange={(val: string) => setLoginForm({...loginForm, password: val})} />
              <button onClick={() => setView('forgot-password')} className="text-[10px] font-bold text-accent uppercase tracking-widest text-right w-full py-1">Forgot Password?</button>
            </div>
            {authError && <p className="text-[10px] text-red-500 font-bold mb-4 uppercase tracking-widest">{authError}</p>}
            <Button className="w-full max-w-sm" onClick={handleLogin}>Continue</Button>
            <button onClick={() => { setAuthError(null); setView('signup'); }} className="mt-8 text-xs font-bold text-gray-400 uppercase tracking-widest py-2">Create Account</button>
          </div>
        );

      case 'forgot-password':
        return (
          <ForgotPasswordView
            onBack={() => setView('login')}
            registeredUsers={registeredUsers}
            onResetPassword={async (email: string) => {
              try {
                const { sendPasswordResetEmail } = await import('firebase/auth');
                await sendPasswordResetEmail(auth, email);
              } catch {}
            }}
            showToast={showToast}
          />
        );

      case 'signup':
        return (
          <div className="fixed inset-0 bg-white p-8 overflow-y-auto no-scrollbar animate-in slide-in-from-right duration-500">
             <header className="flex items-center gap-4 mb-10">
              <button onClick={() => { setAuthError(null); setView('login'); }} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400">
                <span className="material-icons-round">arrow_back</span>
              </button>
              <h1 className="text-2xl font-bold">Sign Up</h1>
            </header>
            <div className="space-y-6">
              <Input label="Email Address" value={signUpForm.email} onChange={(val: string) => setSignUpForm({...signUpForm, email: val})} />
              <Input label="Birth Date" type="date" value={signUpForm.birthDate} onChange={(val: string) => setSignUpForm({...signUpForm, birthDate: val})} />
              <Input label="Display Name" description="5-25 characters" value={signUpForm.displayName} onChange={(val: string) => setSignUpForm({...signUpForm, displayName: val})} />
              <Input label="Username" description="5-25 chars, lowercase, no caps" value={signUpForm.username} onChange={(val: string) => setSignUpForm({...signUpForm, username: val.toLowerCase().replace(/\s/g, '')})} />
              <Input label="Password" type="password" description="Minimum 12 characters" value={signUpForm.password} onChange={(val: string) => setSignUpForm({...signUpForm, password: val})} />
              <div className="space-y-1.5"><label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-2">Location</label><select className="w-full bg-gray-50 rounded-2xl px-6 py-4 text-sm font-medium outline-none appearance-none"><option>United States</option><option>United Kingdom</option><option>Canada</option></select></div>
              {authError && <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest px-2">{authError}</p>}
              <Button className="w-full" onClick={handleSignup}>Join MainWRLD</Button>
            </div>
          </div>
        );

      case 'home':
        return (
          <div className="fixed inset-0 bg-white">
            <Canvas shadows>
              <Suspense fallback={null}>
                <PerspectiveCamera makeDefault position={[0, 5, 10]} fov={50} />
                <pointLight position={[10, 10, 10]} intensity={1.5} />
                <mesh scale={[WORLD_RADIUS, WORLD_RADIUS, WORLD_RADIUS]}><sphereGeometry args={[1, 64, 64]} /><meshStandardMaterial color="#ffffff" transparent opacity={0.15} side={THREE.BackSide} /></mesh>
                <gridHelper args={[100, 50, 0xeeeeee, 0xf5f5f5]} position={[0, -0.01, 0]} />
                <Player moveDir={moveDir} skinColor={avatarConfig ? SKIN_TONE_COLORS[avatarConfig.bodyId] : undefined} />
                {(() => {
                  // Get usernames of actual mutuals (both directions exist)
                  const myAdmiring = relationships.filter(r => r.admirer === user.username).map(r => r.target);
                  const actualMutualUsernames = myAdmiring.filter(t => relationships.some(r => r.admirer === t && r.target === user.username));
                  // Build User objects for actual mutuals from registeredUsers
                  const dynamicMutuals: User[] = actualMutualUsernames.map((username, i) => {
                    const regUser = registeredUsers.find(u => u.username === username);
                    const mutualUser = MUTUALS.find(u => u.username === username);
                    const found = regUser || mutualUser;
                    if (found && (!found.position || (found.position[0] === 0 && found.position[2] === 0))) {
                      const angle = (i / Math.max(actualMutualUsernames.length, 1)) * Math.PI * 2;
                      const radius = 8 + Math.random() * 10;
                      found.position = [Math.cos(angle) * radius, 0, Math.sin(angle) * radius] as [number, number, number];
                    }
                    return found;
                  }).filter(Boolean) as User[];
                  // If no dynamic mutuals, show MUTUALS as fallback so world isn't empty
                  const avatarsToShow = dynamicMutuals.length > 0 ? dynamicMutuals : MUTUALS;
                  // Limit visible mutuals to avoid overwhelming the scene
                  const eightHoursAgo = Date.now() - (8 * 3600 * 1000);
                  const visibleMutuals = avatarsToShow.length > 200
                    ? avatarsToShow.filter((m: any) => m.isOnline || (m.lastOnline && m.lastOnline > eightHoursAgo)).slice(0, 200)
                    : avatarsToShow.slice(0, 200);
                  // Filter out blocked users
                  return visibleMutuals.filter(u => !blockedUsers.has(u.username)).map(u => (
                    <MovingAvatar key={u.username} user={u} onClick={() => { setSelectedProfileUser(u); setView('profile'); }} />
                  ));
                })()}
                <Environment preset="city" />
              </Suspense>
            </Canvas>
            <div className="absolute top-3 left-6 pointer-events-none flex justify-between w-[calc(100%-48px)] items-start">
              <div><img src={`${BASE}wordlogo.png`} alt="MainWRLD" className="w-[240px] drop-shadow-md" /></div>
              <div className="flex flex-col gap-4 pointer-events-auto">
                <button onClick={() => setView('notifications')} className="w-14 h-14 bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl flex items-center justify-center text-gray-500 border border-white relative transition-all active:scale-90">
                  <span className="material-icons-round">notifications</span>
                  {notifications.some(n => n.recipient === user.username && !n.read) && (
                    <span className="absolute top-2 right-2 w-3 h-3 bg-red-500 rounded-full border-2 border-white" />
                  )}
                </button>
                <button onClick={() => setView('daily-rewards')} className="w-14 h-14 bg-accent/90 backdrop-blur-xl rounded-2xl shadow-xl flex flex-col items-center justify-center text-white border border-white relative transition-all active:scale-90"><span className="material-icons-round">card_giftcard</span><span className="text-[7px] font-black uppercase leading-tight">Points</span></button>
              </div>
              </div>
            {/* D-Pad */}
            <div className="absolute bottom-32 right-8 w-32 h-32 flex items-center justify-center pointer-events-none">
              <div className="grid grid-cols-3 gap-1 pointer-events-auto">
                <div /><button onPointerDown={() => setMoveDir(new THREE.Vector3(0, 0, -1))} onPointerUp={() => setMoveDir(new THREE.Vector3(0,0,0))} className="w-10 h-10 bg-black/5 rounded-xl flex items-center justify-center text-black/20"><span className="material-icons-round">keyboard_arrow_up</span></button><div />
                <button onPointerDown={() => setMoveDir(new THREE.Vector3(-1, 0, 0))} onPointerUp={() => setMoveDir(new THREE.Vector3(0,0,0))} className="w-10 h-10 bg-black/5 rounded-xl flex items-center justify-center text-black/20"><span className="material-icons-round">keyboard_arrow_left</span></button><div /><button onPointerDown={() => setMoveDir(new THREE.Vector3(1, 0, 0))} onPointerUp={() => setMoveDir(new THREE.Vector3(0,0,0))} className="w-10 h-10 bg-black/5 rounded-xl flex items-center justify-center text-black/20"><span className="material-icons-round">keyboard_arrow_right</span></button>
                <div /><button onPointerDown={() => setMoveDir(new THREE.Vector3(0, 0, 1))} onPointerUp={() => setMoveDir(new THREE.Vector3(0,0,0))} className="w-10 h-10 bg-black/5 rounded-xl flex items-center justify-center text-black/20"><span className="material-icons-round">keyboard_arrow_down</span></button><div />
              </div>
            </div>
          </div>
        );

         case 'daily-rewards':
        return (
          <div className="fixed inset-0 bg-white overflow-y-auto no-scrollbar pb-32 animate-in fade-in duration-500 z-[400]">
            <header className="p-6 flex items-center gap-4 sticky top-0 bg-white/80 backdrop-blur-xl z-50">
              <button onClick={() => setView('home')} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400">
                <span className="material-icons-round">arrow_back</span>
              </button>
              <h1 className="text-xl font-bold">Daily Rewards</h1>
            </header>
            <div className="p-8 flex flex-col items-center gap-10">
              <div className="text-center space-y-2">
                <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Your Points</p>
                <h2 className="text-5xl font-display text-accent">{user.points}</h2>
              </div>

              {/* Daily Earned Points Progress */}
              {(() => {
                const now = Date.now();
                const isNewDay = !user.lastPointsReset || (now - (user.lastPointsReset || 0) > 24 * 60 * 60 * 1000);
                const earned = isNewDay ? 0 : (user.dailyEarnedPoints || 0);
                const pct = Math.min(100, (earned / MAX_DAILY_EARNED_POINTS) * 100);
                return (
                  <div className="w-full px-2">
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Today's Earned Points</p>
                      <p className="text-sm font-bold text-accent">{earned}/{MAX_DAILY_EARNED_POINTS}</p>
                    </div>
                    <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                    {earned >= MAX_DAILY_EARNED_POINTS && (
                      <p className="text-[10px] text-accent font-bold mt-1 text-center">Daily cap reached! Come back tomorrow.</p>
                    )}
                  </div>
                );
              })()}

              <div className="w-full space-y-8">
                <div className="p-8 bg-gray-50 rounded-[2.5rem] border border-gray-100 flex flex-col items-center gap-6 shadow-sm">
                  <div className="text-center">
                    <h3 className="text-lg font-bold">Daily 3 Points</h3>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Claim every 24 hours</p>
                  </div>
                  <Button className="w-full h-16" onClick={handleClaimPoints}>Claim Points</Button>
                </div>

                <div className="p-8 bg-black rounded-[2.5rem] border border-gray-800 flex flex-col items-center gap-6 shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                   
                  </div>
                  <div className="text-center relative z-10">
                    <h3 className="text-lg font-bold text-white">Coupon Kiosk</h3>
                    <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest">150 Points to win a coupon</p>
                  </div>
                  <div className="w-32 h-32 rounded-full border-4 border-dashed border-accent flex items-center justify-center relative z-10 animate-[spin_10s_linear_infinite]">
                    <span className="material-icons-round text-5xl text-accent">auto_awesome</span>
                  </div>
                  <Button variant="primary" className="w-full h-16 relative z-10" onClick={handleSpinWheel}> Win a $1, $3, $5, or $10 Coupon</Button>
                  <p className="text-[8px] text-white/30 font-bold uppercase tracking-widest text-center mt-2">Win coupons for your next book purchase</p>
                </div>

                {/* Purchase Points Section */}
                <div className="p-8 bg-white rounded-[2.5rem] border border-gray-100 flex flex-col items-center gap-6 shadow-sm">
                  <div className="text-center">
                    <h3 className="text-lg font-bold">Purchase Points</h3>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Get points instantly</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 w-full">
                    {[
                      { usd: 1, pts: 100 },
                      { usd: 3, pts: 300 },
                      { usd: 5, pts: 500 },
                      { usd: 10, pts: 1000 },
                    ].map((pkg) => (
                      <button
                        key={pkg.pts}
                        onClick={() => {
                          const paymentLink = STRIPE_PAYMENT_LINKS[`points_${pkg.pts}`];

                          if (!paymentLink) {
                            // Payment links not configured yet - use in-app confirmation
                            showConfirm({
                              title: `Purchase ${pkg.pts} Points`,
                              message: `Buy ${pkg.pts} points for $${pkg.usd}?`,
                              confirmLabel: 'Purchase',
                              icon: 'auto_awesome',
                              onConfirm: () => {
                                setUser(prev => ({ ...prev, points: prev.points + pkg.pts }));
                                showToast(`${pkg.pts} points added!`, 'check_circle');
                              },
                            });
                            return;
                          }

                          // Store pending points purchase with timestamp for when user returns
                          localStorage.setItem('mainwrld_pending_points', JSON.stringify({ pts: pkg.pts, usd: pkg.usd, timestamp: Date.now() }));
                          // Redirect to Stripe Payment Link
                          window.location.href = paymentLink;
                        }}
                        className="p-4 bg-gray-50 rounded-2xl border border-gray-100 hover:bg-white hover:border-accent transition-all flex flex-col items-center gap-1 group active:scale-95"
                      >
                        <span className="text-lg font-black text-accent">{pkg.pts}</span>
                        <span className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Points</span>
                        <div className="mt-2 px-3 py-1 bg-accent text-white rounded-lg text-[10px] font-bold">
                          ${pkg.usd}
                        </div>
                      </button>
                    ))}
                  </div>
                  <p className="text-[8px] text-gray-400 text-center font-bold uppercase tracking-widest flex items-center justify-center gap-1 mt-2">
                    <span className="material-icons-round text-[10px]">lock</span> Secured by Stripe
                  </p>
                </div>
              </div>

              {/* Premium Membership */}
              <div className="w-full">
                <div className="p-8 bg-gradient-to-br from-amber-50 to-orange-50 rounded-[2.5rem] border border-amber-200 flex flex-col items-center gap-6 shadow-sm relative overflow-hidden">
                  <div className="absolute top-4 right-4">
                    <span className="material-icons-round text-pink-300 text-4xl">workspace_premium</span>
                  </div>
                  <div className="text-center relative z-10">
                    <h3 className="text-lg font-bold text-amber-900">MainWRLD+</h3>
                    <p className="text-[10px] text-amber-600 font-bold uppercase tracking-widest">
                      {user.isPremium ? 'Active Subscription' : '$30 a year'}
                    </p>
                  </div>
                  {user.isPremium ? (
                    <div className="w-full space-y-3">
                      <div className="flex items-center gap-2 text-amber-700">
                        <span className="material-icons-round text-sm">check_circle</span>
                        <span className="text-xs font-bold">No More Ads</span>
                      </div>
                      <div className="flex items-center gap-2 text-amber-700">
                        <span className="material-icons-round text-sm">check_circle</span>
                        <span className="text-xs font-bold">2x daily points (6 pts/day)</span>
                      </div>
                      <div className="flex items-center gap-2 text-amber-700">
                        <span className="material-icons-round text-sm">check_circle</span>
                        <span className="text-xs font-bold">Compete in MainWRLD book contests</span>
                      </div>
                      <div className="flex items-center gap-2 text-amber-700">
                        <span className="material-icons-round text-sm">check_circle</span>
                        <span className="text-xs font-bold">Save Chat Messages Forever</span>
                      </div>
                      <div className="flex items-center gap-2 text-amber-700">
                        <span className="material-icons-round text-sm">check_circle</span>
                        <span className="text-xs font-bold">Annual 200 Point Bonus</span>
                      </div>
                      <div className="pt-3 text-center">
                        <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest">
                          Member since {user.premiumSince ? new Date(user.premiumSince).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'today'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="w-full space-y-3">
                        <div className="flex items-center gap-2 text-amber-700">
                          <span className="material-icons-round text-sm">auto_awesome</span>
                          <span className="text-xs font-bold">No More Ads</span>
                        </div>
                        <div className="flex items-center gap-2 text-amber-700">
                          <span className="material-icons-round text-sm">auto_awesome</span>
                          <span className="text-xs font-bold">2x daily points (6 pts/day)</span>
                        </div>
                        <div className="flex items-center gap-2 text-amber-700">
                          <span className="material-icons-round text-sm">auto_awesome</span>
                          <span className="text-xs font-bold">Compete in MainWRLD book contests</span>
                        </div>
                        <div className="flex items-center gap-2 text-amber-700">
                          <span className="material-icons-round text-sm">auto_awesome</span>
                          <span className="text-xs font-bold">Save Chat Messages Forever</span>
                        </div>
                        <div className="flex items-center gap-2 text-amber-700">
                          <span className="material-icons-round text-sm">auto_awesome</span>
                          <span className="text-xs font-bold">Annual 200 Point Bonus</span>
                        </div>
                      </div>
                      <Button className="w-full h-16 bg-amber-500 hover:bg-amber-600" onClick={() => {
                        if (STRIPE_PREMIUM_PAYMENT_LINK && !STRIPE_PREMIUM_PAYMENT_LINK.includes('test_premium')) {
                          localStorage.setItem('mainwrld_pending_premium', JSON.stringify({ timestamp: Date.now() }));
                          window.location.href = STRIPE_PREMIUM_PAYMENT_LINK;
                        } else {
                          showConfirm({
                            title: 'Upgrade to Premium',
                            message: 'Subscribe to MainWRLD+ for $30/year?',
                            confirmLabel: 'Subscribe',
                            cancelLabel: 'Maybe Later',
                            icon: 'workspace_premium',
                            onConfirm: () => {
                              setUser(prev => ({ ...prev, isPremium: true, premiumSince: new Date().toISOString(), membershipStartDate: Date.now() }));
                              showToast('Welcome to MainWRLD+!', 'workspace_premium');
                            },
                          });
                        }
                      }}>
                        Subscribe — $30/yr
                      </Button>
                      <p className="text-[8px] text-amber-400 text-center font-bold uppercase tracking-widest flex items-center justify-center gap-1">
                        <span className="material-icons-round text-[10px]">lock</span> Secured by Stripe • Cancel anytime
                      </p>
                    </>
                  )}
                </div>
              </div>

               {/* Coupon Slots UI */}
              <div className="w-full space-y-6">
                <div className="flex justify-between items-end px-4">
                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Coupon Slots</h3>
                  <span className="text-[10px] font-bold text-accent">{coupons.filter((c: Coupon) => !c.used).length}/3 Filled</span>
                </div>
                
                <div className="grid grid-cols-3 gap-4">
                  {[0, 1, 2].map((slotIdx) => {
                    // Filter out used coupons before displaying
                    const availableCoupons = coupons.filter((c: Coupon) => !c.used);
                    const coupon = availableCoupons[slotIdx];
                    return (
                      <div
                        key={slotIdx}
                        className={`aspect-square rounded-[1.8rem] border-2 flex flex-col items-center justify-center gap-1 transition-all ${coupon ? 'bg-accent/5 border-accent shadow-lg shadow-accent/10' : 'bg-gray-50 border-dashed border-gray-200 opacity-50'}`}
                      >
                        {coupon ? (
                          <>
                            <span className="material-icons-round text-accent text-xl">confirmation_number</span>
                            <span className="text-lg font-black text-accent">${coupon.value}</span>
                            <span className="text-[7px] font-bold text-accent/60 uppercase tracking-tighter">{slotIdx === 0 ? 'Oldest Slot' : slotIdx === 2 ? 'Newest Slot' : 'Slot ' + (slotIdx + 1)}</span>
                          </>
                        ) : (
                          <>
                            <span className="material-icons-round text-gray-300">lock_open</span>
                            <span className="text-[8px] font-bold text-gray-300 uppercase">Empty</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {coupons.length > 0 && (
                  <div className="space-y-3 mt-8">
                    <h4 className="text-[9px] font-bold text-gray-300 uppercase tracking-[0.2em] px-4">Inventory Details</h4>
                    {coupons.map((c, idx) => (
                      <div key={c.id} className="p-5 bg-gray-50 border border-gray-100 rounded-2xl flex justify-between items-center animate-in slide-in-from-right duration-300" style={{ animationDelay: `${idx * 100}ms` }}>
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${idx === 0 ? 'bg-red-50 text-red-500' : 'bg-accent/10 text-accent'}`}>
                             <span className="material-icons-round text-sm">{idx === 0 ? 'history' : 'local_offer'}</span>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-black">${c.value} Off Discount</p>
                            <p className="text-[8px] font-bold text-gray-400 uppercase">{idx === 0 ? 'Removed next' : 'Stored in slot ' + (idx + 1)}</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-black text-accent uppercase tracking-widest">Unused</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'cart':
  return (
    <CartView 
      cart={cart} 
      setCart={setCart} 
      coupons={coupons} 
      setCoupons={setCoupons} 
      onBack={() => setView('self-profile')} 
      onOwnedUpdate={(bookId: string) => {

        
        setUserOwnsBook(bookId);

  
        setBooks(prev => {
          const updated = prev.map(b =>
            b.id === bookId ? { ...b, isOwned: true } : b
          );

          if (selectedBook && selectedBook.id === bookId) {
            setSelectedBook({ ...selectedBook, isOwned: true });
          }

          return updated;
        });
      }}
      showToast={showToast}
      showConfirm={showConfirm}
    />
  );


      case 'explore':
        return <ExploreView
          books={books.filter((b: Book) => !blockedUsers.has(b.author.username) && !b.isDraft && !(userIsUnder16 && b.isExplicit))}
          onSelect={(b: Book) => { setSelectedBook(b); setView('book-detail'); }}
          users={[...registeredUsers.filter((u: any) => u.username !== user.username), ...MUTUALS.filter(m => !registeredUsers.some((u: any) => u.username === m.username) && m.username !== user.username)]}
          onUserSelect={(u: User) => { setSelectedProfileUser(u); setView('profile'); }}
          blockedUsers={blockedUsers}
          readingActivity={readingActivity}
          currentUsername={user.username}
          onAuthorSelect={(u: User) => { setSelectedProfileUser(u); setView('profile'); }}
          userFavoriteGenres={(() => {
            const genreCounts: Record<string, number> = {};
            books.filter(b => b.isFavorite || b.isOwned).forEach(b => {
              (b.genres || []).forEach((g: string) => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
            });
            return Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0]);
          })()}
        />;

      case 'library':
        const ownedIds = getUserOwnedBookIds();
        const ownedBooks = books.filter(b => ownedIds.has(b.id) && !blockedUsers.has(b.author.username));
        
        return (
          <div className="fixed inset-0 bg-white overflow-y-auto no-scrollbar pb-32 animate-in fade-in duration-500">
            <div>
              <header className="p-6 border-b border-gray-50 flex justify-between items-center">
                <div><h1 className="text-2xl font-bold">Library</h1><p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">{ownedBooks.length}/{MAX_LIBRARY_SIZE} Saved</p></div>
                <div className="w-24 h-2 bg-gray-50 rounded-full overflow-hidden"><div className="h-full bg-accent" style={{ width: `${(ownedBooks.length / MAX_LIBRARY_SIZE) * 100}%` }} /></div>
              </header>
              <div className="flex flex-wrap gap-4 p-6">
                {ownedBooks.map(b => {
                  const progressData = getUserBookProgress(b.id);
                  const scrollProgress = progressData.scrollProgress || 0;
                  const chapterIndex = progressData.chapterIndex || 0;
                  const currentChapterTitle = b.chapters?.[chapterIndex]?.title || null;
                  
                  return (
                  <div key={b.id} onClick={() => { setSelectedBook(b); setView('book-detail'); }} className="space-y-2 cursor-pointer w-28">
                    <div className="aspect-[2/3] rounded-lg shadow-lg border-2 border-white overflow-hidden relative" style={{ backgroundColor: b.coverColor }}>
                      <CoverImg book={b} />
                      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/60 to-transparent z-20">
            {currentChapterTitle && (
                       <p className="text-xs text-white font-semibold mb-1 truncate">{currentChapterTitle}</p> )}
                      <p className="text-[10px] text-white/80 font-bold uppercase tracking-wider mb-1">{scrollProgress}% Read</p>
                    <div className="w-full h-1.5 bg-white/30 rounded-full overflow-hidden"><div className="h-full bg-accent" style={{ width: `${scrollProgress}%` }}/>
                      </div>
                      </div>
                    </div>
                    <div className="px-1">
                      <p className="text-xs font-bold truncate">{b.title}</p>
                      <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider truncate">{b.author.displayName}</p>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
          
        );

      case 'write':
        return <WriteView
          books={books}
          user={user}
          initialBookId={lastSelectedBookId}
          initialChapterIndex={lastSelectedChapterIndex}
          onSelectionChange={(id: string, ch: string) => {
            setLastSelectedBookId(id);
            setLastSelectedChapterIndex(ch);
          }}
          onPublish={async (id: string|null, title: string, content: string, chapterIndex: number | null) => {

            let effectiveId = id;
            if (!effectiveId) {
              // For new books, create in Firestore and wait for the ID
              const bookData = {
                title: title.trim(),
                authorUid: firebaseUid || '',
                authorUsername: user?.username || '',
                authorDisplayName: user?.displayName || '',
                coverColor: '#' + Math.floor(Math.random()*16777215).toString(16),
                likes: [0],
                commentsCount: 0,
                publishedDate: new Date().toISOString().split('T')[0],
                isCompleted: false,
                isDraft: true,
                isExplicit: false,
                chaptersCount: content.trim() ? 1 : 0,
                tagline: '',
                genres: [],
                hashtags: [],
                content,
                chapters: content.trim() ? [{ title: 'Chapter 1', content }] : []
              };
              try {
                const created = await fbService.createBook(bookData);
                effectiveId = (created as any).id;
              } catch (err) {
                console.error('Failed to create book:', err);
                return;
              }
            } else {
              // Existing book — save draft
              handleSaveDraft(id, title, content, chapterIndex);
            }

            if (effectiveId) {
              const existingBook = books.find(b => b.id === effectiveId);
              setCurrentPublishingId(effectiveId);
              setCurrentPublishingTitle(title);
              setCurrentPublishingContent(content);
              setCurrentPublishingChapterIndex(chapterIndex);
              setPublishingInitialData(existingBook ? {
                tagline: existingBook.tagline,
                genres: existingBook.genres,
                hashtags: existingBook.hashtags,
                isExplicit: existingBook.isExplicit,
                commentsEnabled: existingBook.commentsEnabled
            } : null);
            setView('publishing');
            }
          }}
          onSaveDraft={handleSaveDraft}
          onMonetize={() => setView('monetization-request')}
          onBack={() => setView('home')}
          onNotify={(title: string, message: string) => {
            const newNotif = {
              id: Math.random().toString(36).substr(2, 9),
              title,
              message,
              icon: 'warning'
            };
            setNotifications(prev => [newNotif, ...prev]);
          }}
        />;

      case 'publishing':
        return <PublishingView initialData={publishingInitialData} onPost={handlePublish} onBack={() => setView('write')} isNewBook={!currentPublishingId} />;

      case 'monetization-request':
        return <MonetizationRequestView user={user} works={books.filter(b => b.author.username === user.username)} onRequest={handleRequestMonetization} onBack={() => setView('write')} showToast={showToast} />;

      case 'self-profile':
        return (
          <div className="fixed inset-0 bg-white overflow-y-auto no-scrollbar pb-32 animate-in fade-in duration-500">
            <header className="p-6 flex justify-end items-center sticky top-0 bg-white/80 backdrop-blur-md z-50">
              <div className="flex gap-2">
                <button onClick={() => setView('cart')} className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400 relative">
                  <span className="material-icons-round">shopping_cart</span>
                  {cart.length > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-accent text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-white">{cart.length}</span>}
                </button>
                <button onClick={() => setView('settings')} className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400"><span className="material-icons-round">settings</span></button>
              </div>
            </header>
            <div className="p-6 flex flex-col items-center">
              {avatarConfig ? (
                <div className="w-36 h-36 rounded-[3rem] overflow-hidden border-4 border-white shadow-2xl mb-6 relative bg-gray-50">
                  <div className="absolute left-1/2" style={{ width: '140px', height: '194px', transform: 'translateX(-50%) scale(2.2)', transformOrigin: 'top center', top: '8%' }}>
                    <img src={getAvatarItemPath('body', avatarConfig.bodyId)} className="absolute inset-0 w-full h-full object-contain" style={{zIndex:1}} />
                    {avatarConfig.faceId !== 'no_face' && <img src={getAvatarItemPath('face', avatarConfig.faceId)} className="absolute" style={{zIndex:2, ...getFacePosition(avatarConfig.faceId)}} />}
                    <img src={getAvatarItemPath('outfit', avatarConfig.outfitId)} className="absolute inset-0 w-full h-full object-contain" style={{zIndex:3}} />
                    {avatarConfig.hairId !== 'none' && <img src={getAvatarItemPath('hair', avatarConfig.hairId)} className="absolute" style={{zIndex:4, ...getHairPosition(avatarConfig.hairId)}} />}
                  </div>
                </div>
              ) : (
                <div className="w-32 h-32 rounded-[3rem] bg-accent/5 flex items-center justify-center text-accent text-5xl font-bold mb-6 border-4 border-white shadow-2xl">{user.displayName[0]}</div>
              )}
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{user.displayName}</h1>
                {user.isPremium && <span className="material-icons-round text-pink-500 text-lg">workspace_premium</span>}
              </div>
              <p className="text-xs text-gray-300 font-bold uppercase tracking-widest mb-10">@{user.username}</p>
              <div className="grid grid-cols-4 gap-4 w-full px-4 mb-10">
                <div className="text-center"><p className="text-lg font-bold">{user.points}</p><p className="text-[8px] font-bold text-gray-300 uppercase tracking-widest">Points</p></div>
                <div className="text-center"><p className="text-lg font-bold">{(() => { const admiring = relationships.filter(r => r.admirer === user.username).map(r => r.target); return admiring.filter(t => relationships.some(r => r.admirer === t && r.target === user.username)).length; })()}</p><p className="text-[8px] font-bold text-gray-300 uppercase tracking-widest">Mutuals</p></div>
                <div className="text-center"><p className="text-lg font-bold">{relationships.filter(r => r.target === user.username).length}</p><p className="text-[8px] font-bold text-gray-300 uppercase tracking-widest">Admirers</p></div>
                <div className="text-center"><p className="text-lg font-bold">{relationships.filter(r => r.admirer === user.username).length}</p><p className="text-[8px] font-bold text-gray-300 uppercase tracking-widest">Admiring</p></div>
              </div>
              <Button className="w-full max-w-xs mb-10" onClick={() => setView('customization')}><span className="material-icons-round">palette</span> CUSTOMIZE</Button>
              <section className="w-full space-y-6 mb-12">
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">Your Works</h3>
                <div className="flex gap-6 overflow-x-auto no-scrollbar px-2">
                  {/* Updated to filter out drafts */}
                  {books.filter(b => b.author.username === user.username && !b.isDraft).map(b => (
                    <div key={b.id} onClick={() => { setSelectedBook(b); setView('book-detail'); }} className="flex-shrink-0 w-32 cursor-pointer space-y-2">
                      <div className={`aspect-[2/3] rounded-lg shadow-md border-4 border-white overflow-hidden relative ${b.isDraft ? 'opacity-50' : ''}`} style={{ backgroundColor: b.coverColor }}><CoverImg book={b} /></div>
                      <div className="px-1">
                        <p className="text-xs font-bold truncate">{b.title}</p>
                        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider truncate">{b.author.displayName}</p>
                      </div>
                    </div>
                  ))}
                   {books.filter(b => b.author.username === user.username && !b.isDraft).length === 0 && <p className="text-[9px] font-bold text-gray-300 uppercase tracking-widest ml-2 py-4">No published works</p>}
                </div>
              </section>
              <section className="w-full space-y-6">
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">Favorites</h3>
                <div className="flex gap-6 overflow-x-auto no-scrollbar px-2">
                  {books.filter(b => b.isFavorite).map(b => (
                    <div key={b.id} onClick={() => { setSelectedBook(b); setView('book-detail'); }} className="flex-shrink-0 w-32 cursor-pointer space-y-2">
                      <div className="aspect-[2/3] rounded-lg shadow-md border-4 border-white overflow-hidden relative" style={{ backgroundColor: b.coverColor }}><CoverImg book={b} /></div>
                      <div className="px-1">
                        <p className="text-xs font-bold truncate">{b.title}</p>
                        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider truncate">{b.author.displayName}</p>
                      </div>
                    </div>
                  ))}
                  {books.filter(b => b.isFavorite).length === 0 && <p className="text-[9px] font-bold text-gray-300 uppercase tracking-widest ml-2 py-4">No favorites yet</p>}
                </div>
              </section>
            </div>
          </div>
        );

      case 'customization':
        return <CustomizationView user={user} setUser={setUser} onBack={() => setView('self-profile')} avatarConfig={avatarConfig} setAvatarConfig={setAvatarConfig} unlockedAvatarItems={unlockedAvatarItems} setUnlockedAvatarItems={setUnlockedAvatarItems} isAdmin={isAdmin} getItemCost={getItemCost} />;


      case 'notifications': {
        // Sort once: newest first
        const sortedNotifs = notifications
          .filter(n => n.recipient === user.username && !blockedUsers.has(n.sender || ''))
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        // Mark all as read after a short delay so user sees unread state first
        if (sortedNotifs.some(n => !n.read)) {
          setTimeout(() => fbService.markNotificationsRead(user.username).catch(console.error), 2000);
        }
        return (
            <div className="fixed inset-0 bg-white overflow-y-auto no-scrollbar animate-in slide-in-from-right duration-500">
            <header className="p-6 flex items-center gap-4">
                <button
                onClick={() => setView('home')}
                className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400"
                >
                <span className="material-icons-round">arrow_back</span>
                </button>
                <h1 className="text-xl font-bold">Notifications</h1>
            </header>

            <div className="p-6 space-y-4">
                {sortedNotifs.length > 0 ? sortedNotifs.map((n) => (
                <div
                    key={n.id}
                    className={`p-5 rounded-[1.5rem] border flex gap-4 items-start ${!n.read ? 'bg-accent/10 border-accent/20' : 'bg-accent/5 border-accent/10'}`}
                >
                    <div className="relative shrink-0">
                      <div className="w-12 h-12 rounded-2xl bg-accent text-white flex items-center justify-center">
                        <span className="material-icons-round">{n.icon}</span>
                      </div>
                      {!n.read && <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white" />}
                    </div>
                    <div className="min-w-0">
                    <p className={`text-xs font-bold ${!n.read ? 'text-black' : 'text-gray-600'}`}>{n.title}</p>
                    <p className="text-[10px] text-gray-400">{n.message}</p>
                    </div>
                </div>
                )) : (
                    <div className="text-center py-20 text-gray-300 font-bold uppercase tracking-widest text-[10px]">No new notifications</div>
                )}
            </div>
            </div>
        );
      }
  
      case 'profile':
        return selectedProfileUser && (
          <OtherProfileView
            user={selectedProfileUser}
            books={books}
            onBack={() => setView('home')}
            onBookSelect={(b: Book) => { setSelectedBook(b); setView('book-detail'); }}
            onAdmire={() => handleAdmire(selectedProfileUser)}
            onBlock={() => handleBlockUser(selectedProfileUser.username)}
            onReport={() => handleReport('User', selectedProfileUser.username)}
            onMessage={() => { setSelectedChatUser(selectedProfileUser.username); setView('chat-conversation'); }}
            relationships={relationships}
            currentUsername={user.username}
            readingActivity={readingActivity}
            avatarConfig={allAvatarConfigs[selectedProfileUser.username] || null}
          />
        );

      case 'settings':
        return <SettingsView
          onBack={() => setView('self-profile')}
          handleLogout={handleLogout}
          onNavigate={(v: View) => setView(v)}
          isAdmin={isAdmin}
          user={user}
          onUpdateUser={(updatedUser: User) => {
            setUser(updatedUser);
            if (firebaseUid) {
              fbService.updateUserProfile(firebaseUid, {
                displayName: updatedUser.displayName,
                points: updatedUser.points,
                strikes: updatedUser.strikes,
              }).catch(console.error);
            }
          }}
          onUpdatePassword={async (newPassword: string) => {
            try {
              await fbService.changePassword(newPassword);
              showToast('Password updated!', 'check_circle');
            } catch (err: any) {
              showToast('Failed to update password. You may need to log in again.', 'error');
            }
          }}
          showToast={showToast}
        />;

      case 'notification-settings':
        return (
          <div className="fixed inset-0 bg-white p-8 overflow-y-auto no-scrollbar animate-in slide-in-from-right duration-500">
            <header className="flex items-center gap-4 mb-10">
              <button onClick={() => setView('settings')} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400">
                <span className="material-icons-round">arrow_back</span>
              </button>
              <h1 className="text-xl font-bold">Notifications</h1>
            </header>
            <div className="space-y-6">
              {['New Admirers', 'Book Likes', 'Comments', 'App Updates'].map(item => (
                <div key={item} className="flex justify-between items-center p-6 bg-gray-50 rounded-3xl">
                  <span className="text-sm font-bold">{item}</span>
                  <input type="checkbox" defaultChecked className="accent-accent w-5 h-5" />
                </div>
              ))}
            </div>
          </div>
        );

      case 'blocked-users':
        return (
          <div className="fixed inset-0 bg-white p-8 overflow-y-auto no-scrollbar animate-in slide-in-from-right duration-500">
            <header className="flex items-center gap-4 mb-10">
              <button onClick={() => setView('settings')} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400">
                <span className="material-icons-round">arrow_back</span>
              </button>
              <h1 className="text-xl font-bold">Blocked Users</h1>
              <span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">{blockedUsers.size}</span>
            </header>
            {blockedUsers.size === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-300">
                <span className="material-icons-round text-4xl mb-4">block</span>
                <p className="text-[10px] font-bold uppercase tracking-widest">No blocked users</p>
              </div>
            ) : (
              <div className="space-y-3">
                {[...blockedUsers].map(blockedUsername => {
                  const blockedUser = registeredUsers.find(u => u.username === blockedUsername) || MUTUALS.find(u => u.username === blockedUsername);
                  return (
                    <div key={blockedUsername} className="flex items-center gap-4 p-5 bg-gray-50 rounded-3xl border border-gray-100">
                      <div className="w-12 h-12 rounded-2xl bg-gray-200 flex items-center justify-center text-gray-400">
                        <span className="material-icons-round">person</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">{blockedUser?.displayName || blockedUsername}</p>
                        <p className="text-[10px] text-gray-400 font-bold">@{blockedUsername}</p>
                      </div>
                      <button
                        onClick={() => handleUnblockUser(blockedUsername)}
                        className="px-5 py-2.5 bg-white rounded-2xl text-xs font-bold border border-gray-200 text-gray-500 transition-all active:scale-95 hover:border-accent hover:text-accent"
                      >
                        Unblock
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );

      case 'book-detail':
        return selectedBook && (
          <PublicBookDetailPage
            currentUser={user}
            book={selectedBook}
            isOwned={getUserOwnedBookIds().has(selectedBook.id)}
            bookProgress={getUserBookProgress(selectedBook.id)}
            onBack={() => setView('explore')}
            onRead={() => { setReadingActivity(prev => { const ua = [...(prev[user.username] || [])]; const ei = ua.findIndex(a => a.bookId === selectedBook.id); const entry = { bookId: selectedBook.id, progress: getUserBookProgress(selectedBook.id).scrollProgress, lastRead: new Date().toISOString() }; if (ei >= 0) ua[ei] = entry; else ua.unshift(entry); return { ...prev, [user.username]: ua.slice(0, 10) }; }); setView('reading'); }}
            onAuthorClick={(u: User) => { setSelectedProfileUser(u); setView('profile'); }}
            onSave={() => handleSaveToLibrary(selectedBook.id)}
            onRemove={() => handleRemoveFromLibrary(selectedBook.id)}
            isSaved={isBookInLibrary(selectedBook.id)}
            onReport={() => handleReport('Book', selectedBook.id)}
            onShare={() => handleShareBook(selectedBook)}
            onAddToCart={() => handleAddToCart(selectedBook)}
            onToggleFavorite={() => handleToggleFavorite(selectedBook.id)}
            onDelete={handleDeleteBook}
            onUnpublish={handleUnpublish}
            onMarkCompleted={handleMarkCompleted}
          />
        );

      case 'reading':
        const savedProgress = selectedBook ? getUserBookProgress(selectedBook.id) : { scrollProgress: 0, chapterIndex: 0 };
        return (
          <ReadingView
            currentUser={user}
            book={selectedBook}
            initialScrollProgress={savedProgress.scrollProgress}
            initialChapterIndex={savedProgress.chapterIndex}
            settings={readerSettings}
            setSettings={setReaderSettings}
            onBack={() => setView('book-detail')}
            onComments={(chapterIdx?: number) => { setReadingChapterIndex(chapterIdx ?? 0); setView('comments'); }}
            likedChapters={likedBooks}
            onLike={(chapterIdx: number) => selectedBook && handleLike(selectedBook.id, chapterIdx)}
            onSave={() => selectedBook && handleSaveToLibrary(selectedBook.id)}
            isSaved={selectedBook ? isBookInLibrary(selectedBook.id) : false}
            canSave={selectedBook ? (user.username !== selectedBook.author.username && (getUserOwnedBookIds().has(selectedBook.id) || selectedBook.isFree || !selectedBook.isMonetized)) : false}
            chapterCommentsCount={allComments.filter((c: any) => c.bookId === selectedBook?.id && (c.chapterIndex ?? 0) === readingChapterIndex).length}
            onProgressUpdate={(scrollProgress: number, chapterIndex: number) => { setReadingChapterIndex(chapterIndex); selectedBook && handleBookProgressUpdate(selectedBook.id, scrollProgress, chapterIndex); }}
            onShare={() => selectedBook && handleShareBook(selectedBook)}
          />
        );
        

      case 'comments':
        return <CommentsView
            comments={allComments.filter(c => {
              if (c.bookId !== selectedBook?.id) return false;
              // Filter out comments by blocked users (match by displayName)
              const commentAuthor = registeredUsers.find(u => u.displayName === c.author) || MUTUALS.find(u => u.displayName === c.author);
              if (commentAuthor && blockedUsers.has(commentAuthor.username)) return false;
              return true;
            })}
            onPost={postComment}
            onBack={() => setView('reading')}
            onReport={(id: string) => handleReport('Comment', id)}
            onLikeComment={handleLikeComment}
            currentUsername={user.username}
            chapters={selectedBook?.chapters || []}
            initialChapterIndex={readingChapterIndex}
        />;

      case 'admin-dashboard':
        return (
          <AdminDashboard
            reports={reports}
            books={books.filter((b: any) => !b.isDraft)}
            comments={allComments}
            registeredUsers={registeredUsers}
            onBack={() => setView('settings')}
            onRemoveBook={handleRemoveBook}
            onRemoveComment={handleRemoveComment}
            onAddStrike={handleAddStrike}
            onRemoveStrike={handleRemoveStrike}
            onBanUser={handleBanUser}
            onDismissReport={handleDismissReport}
            getItemCost={getItemCost}
            onUpdateItemPrice={handleUpdateItemPrice}
          />
        );

      case 'chat':
        return <ChatListView
          currentUsername={user.username}
          relationships={relationships}
          registeredUsers={registeredUsers}
          mutualsFallback={MUTUALS}
          chatMessages={chatMessages}
          blockedUsers={blockedUsers}
          avatarConfigs={registeredUsers.reduce((acc: any, u: any) => { if (u.avatar) acc[u.username] = u.avatar; return acc; }, {})}
          onSelectChat={(username: string) => { setSelectedChatUser(username); setView('chat-conversation'); }}
          onBack={() => setView('home')}
          getAvatarItemPath={getAvatarItemPath}
        />;

      case 'chat-conversation':
        const chatIsMutual = selectedChatUser ? (
          relationships.some(r => r.admirer === user.username && r.target === selectedChatUser) &&
          relationships.some(r => r.admirer === selectedChatUser && r.target === user.username)
        ) : false;
        return <ChatConversationView
          currentUsername={user.username}
          currentDisplayName={user.displayName}
          targetUsername={selectedChatUser || ''}
          targetUser={registeredUsers.find(u => u.username === selectedChatUser) || MUTUALS.find(u => u.username === selectedChatUser)}
          messages={chatMessages.filter(m =>
            (m.from === user.username && m.to === selectedChatUser) ||
            (m.from === selectedChatUser && m.to === user.username)
          )}
          onSend={(text: string) => selectedChatUser && handleSendMessage(selectedChatUser, text)}
          onBack={() => setView('chat')}
          getAvatarItemPath={getAvatarItemPath}
          avatarConfig={(registeredUsers.find(u => u.username === selectedChatUser) as any)?.avatar}
          isMutual={chatIsMutual}
        />;

      default:
        return <div className="fixed inset-0 flex items-center justify-center">Missing View: {view}</div>;
    }
  };

  const showNav = ['home', 'explore', 'library', 'write', 'self-profile'].includes(view);

  return (
    <div className="min-h-screen bg-white transition-colors duration-500 overflow-hidden text-black font-sans">
      {renderView()}
      {showNav && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-xl border-t border-gray-100 px-6 py-4 flex justify-around items-center z-[200]">
          {[
            { id: 'home', icon: 'home', label: 'Home' },
            { id: 'explore', icon: 'explore', label: 'Explore' },
            { id: 'library', icon: 'bookmarks', label: 'Library' },
            { id: 'write', icon: 'edit_note', label: 'Write' },
            { id: 'self-profile', icon: 'person', label: 'Me' }
          ].map(tab => (
            <button key={tab.id} onClick={() => setView(tab.id as View)} className={`flex flex-col items-center gap-1 transition-all ${view === tab.id ? 'text-accent scale-110' : 'text-gray-400 opacity-60'}`}><span className="material-icons-round text-2xl">{tab.icon}</span><span className="text-[8px] font-bold uppercase tracking-tighter">{tab.label}</span></button>
          ))}
        </nav>
      )}
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[9999] animate-in slide-in-from-top fade-in duration-300">
          <div className="flex items-center gap-3 px-6 py-4 bg-black/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10">
            <span className="material-icons-round text-accent">{toast.icon}</span>
            <span className="text-sm font-bold text-white">{toast.message}</span>
          </div>
        </div>
      )}
      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9998] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full space-y-6 animate-in zoom-in-95 duration-300">
            <div className="text-center space-y-3">
              <div className={`w-16 h-16 ${confirmModal.iconBg || 'bg-accent/10'} rounded-full flex items-center justify-center mx-auto`}>
                <span className={`material-icons-round text-3xl ${confirmModal.iconBg ? 'text-white' : 'text-accent'}`}>{confirmModal.icon || 'shopping_cart'}</span>
              </div>
              <h2 className="text-lg font-bold">{confirmModal.title}</h2>
              <p className="text-sm text-gray-400 leading-relaxed">{confirmModal.message}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { confirmModal.onCancel?.(); setConfirmModal(null); }} className="flex-1 py-4 rounded-2xl bg-gray-100 text-sm font-bold transition-all active:scale-95">{confirmModal.cancelLabel || 'Cancel'}</button>
              <button onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }} className="flex-1 py-4 rounded-2xl bg-accent text-white text-sm font-bold transition-all active:scale-95">{confirmModal.confirmLabel || 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Subviews Components ---

const ExploreView = ({ books, onSelect, onAuthorSelect, users = [], onUserSelect, blockedUsers = new Set(), readingActivity = {}, currentUsername = '', userFavoriteGenres = [] }: any) => {
  const [showFilter, setShowFilter] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const query = searchQuery.toLowerCase().trim();
  const isHashtagSearch = query.startsWith('#');
  const cleanQuery = isHashtagSearch ? query.slice(1) : query;

  const filteredBooks = useMemo(() => {
    let result = books.filter((b: Book) => {
      if (b.isDraft) return false;
      if (!cleanQuery) return true;
      if (isHashtagSearch) {
        // Search hashtags only
        return (b.hashtags || []).some((h: string) => h.toLowerCase().includes(cleanQuery));
        
      }
      
      // Search title, author name, username, tagline, and hashtags
      const matchesTitle = b.title.toLowerCase().includes(cleanQuery);
      const matchesAuthor = b.author.displayName.toLowerCase().includes(cleanQuery) || b.author.username.toLowerCase().includes(cleanQuery);
      const matchesTagline = (b.tagline || '').toLowerCase().includes(cleanQuery);
      const matchesHashtags = (b.hashtags || []).some((h: string) => h.toLowerCase().includes(cleanQuery));
      return matchesTitle || matchesAuthor || matchesTagline || matchesHashtags;
      
    });

    if (selectedGenres.length > 0) {
      result = result.filter((b: Book) => selectedGenres.some(g => (b.genres || []).includes(g)));
    }

    result = [...result].sort((a: Book, b: Book) => {
      const dateA = new Date(a.publishedDate).getTime();
      const dateB = new Date(b.publishedDate).getTime();
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

    return result;
  }, [books, cleanQuery, isHashtagSearch, selectedGenres, sortOrder]);

  // User search results — only show when searching and not a hashtag search
  const filteredUsers = useMemo(() => {
    if (!cleanQuery || isHashtagSearch) return [];
    return (users as User[]).filter((u: User) => {
      if (blockedUsers.has(u.username)) return false;
      return u.displayName.toLowerCase().includes(cleanQuery) || u.username.toLowerCase().includes(cleanQuery);
    }).slice(0, 5); // Limit to 5 results
  }, [users, cleanQuery, isHashtagSearch, blockedUsers]);

   const spotlightBook = useMemo(() => {
    const currentWeekEpoch = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
    const publicBooks = books.filter((b: Book) => !b.isDraft);
    const sortedByFaves = [...publicBooks].sort((a, b) => (b.favoritesLastWeek || 0) - (a.favoritesLastWeek || 0));
    const uniqueIndex = currentWeekEpoch % sortedByFaves.length;
    return sortedByFaves[uniqueIndex] || sortedByFaves[0];
  }, [books]);

  const topAuthors = useMemo(() => {
    const authorMap: Record<string, { user: User; totalLikes: number }> = {};
    books.filter((b: Book) => !b.isDraft).forEach((b: Book) => {
      const username = b.author.username;
      if (!authorMap[username]) {
        authorMap[username] = { user: b.author, totalLikes: 0 };
      }
      authorMap[username].totalLikes += Array.isArray(b.likes) ? b.likes.reduce((a: number, c: number) => a + c, 0) : (b.likes || 0);
    });
    return Object.values(authorMap)
      .sort((a, b) => b.totalLikes - a.totalLikes)
      .slice(0, 10);
  }, [books]);

  // Trending Books: sorted by likes (likes per hour by using total likes + recency)
  const trendingBooks = useMemo(() => {
    return [...books].sort((a: Book, b: Book) => {
      const now = Date.now();
      const ageA = (now - new Date(a.publishedDate).getTime()) / (1000 * 60 * 60); // hours
      const ageB = (now - new Date(b.publishedDate).getTime()) / (1000 * 60 * 60);
      const totalLikesA = Array.isArray(a.likes) ? a.likes.reduce((x: number, y: number) => x + y, 0) : (a.likes || 0);
      const totalLikesB = Array.isArray(b.likes) ? b.likes.reduce((x: number, y: number) => x + y, 0) : (b.likes || 0);
      const scoreA = totalLikesA / Math.max(ageA, 1); // likes per hour
      const scoreB = totalLikesB / Math.max(ageB, 1);
      return scoreB - scoreA;
    }).slice(0, 10);
  }, [books]);

  // Recently Read: last 3 books the user has been reading
  const recentlyRead = useMemo(() => {
    const activities = readingActivity[currentUsername];
    if (!activities || activities.length === 0) return [];
    return activities
      .sort((a, b) => new Date(b.lastRead).getTime() - new Date(a.lastRead).getTime())
      .slice(0, 3)
      .map(a => books.find((b: Book) => b.id === a.bookId))
      .filter(Boolean);
  }, [books, readingActivity, currentUsername]);

  // Recommended: trending books matching user's top 2 favorite genres
  const recommendedBooks = useMemo(() => {
    if (userFavoriteGenres.length === 0) {
      // Fallback to trending if no favorite genres
      return trendingBooks.slice(0, 6);
    }
    return trendingBooks
      .filter((b: Book) => (b.genres || []).some((g: string) => userFavoriteGenres.includes(g)))
      .slice(0, 10);
  }, [trendingBooks, userFavoriteGenres]);

  return (
    <div className="fixed inset-0 bg-[#fbfbfc] overflow-y-auto no-scrollbar pb-32 animate-in fade-in duration-500">
      <header className="p-6 sticky top-0 bg-white/90 backdrop-blur-2xl z-50 border-b border-gray-100">
        <div className="flex gap-4 items-center">
          <div className="flex-1 bg-gray-100/50 rounded-2xl flex items-center px-4 py-3.5 gap-3 border border-gray-100">
            <span className="material-icons-round text-gray-400">search</span>
            <input 
              placeholder="Search books, users, #hashtags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent outline-none text-sm w-full font-medium placeholder:text-gray-400" 
            />
          </div>
          <button onClick={() => setShowFilter(!showFilter)} className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${showFilter ? 'bg-accent text-white shadow-lg shadow-accent/30' : 'bg-white text-gray-400 border border-gray-100 hover:bg-gray-50'}`}><span className="material-icons-round">tune</span></button>
        </div>
        {showFilter && (
          <div className="mt-4 p-5 bg-white rounded-3xl space-y-5 animate-in slide-in-from-top border border-gray-100 shadow-xl shadow-black/[0.03]">
            <div className="flex flex-wrap gap-2">
              {GENRE_LIST.map(g => (
                <button key={g} onClick={() => setSelectedGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g])} className={`px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase transition-all tracking-wider ${selectedGenres.includes(g) ? 'bg-accent text-white border-accent' : 'bg-gray-50 text-gray-500 border border-gray-100 hover:bg-gray-100'}`}>{g}</button>
              ))}
            </div>
            <div className="flex justify-between items-center border-t border-gray-50 pt-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sort order</p>
              <select 
                className="text-[10px] font-bold bg-gray-50 px-3 py-2 rounded-lg outline-none cursor-pointer text-gray-700"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
              </select>
            </div>
          </div>
        )}
      </header>

      <main className="space-y-12 py-8">
        {/* User Search Results */}
        {filteredUsers.length > 0 && (
          <section className="px-6 space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-2">People</h3>
            <div className="bg-white rounded-[2rem] border border-gray-100 overflow-hidden shadow-sm">
              {filteredUsers.map((u: User) => (
                <button key={u.username} onClick={() => onUserSelect(u)} className="w-full p-4 flex items-center gap-4 border-b border-gray-50 last:border-none hover:bg-gray-50 transition-colors active:scale-[0.98]">
                  <div className="w-11 h-11 rounded-2xl bg-accent/10 flex items-center justify-center text-accent text-lg font-bold flex-shrink-0">
                    {u.displayName[0]}
                  </div>
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{u.displayName}</p>
                    <p className="text-[10px] text-gray-400 font-bold">@{u.username}</p>
                  </div>
                  <div className="flex items-center gap-1 text-gray-300">
                    <span className="material-icons-round text-sm">chevron_right</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* When searching — show flat results list */}
        {query && (
          <section className="space-y-6">
            <div className="px-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-gray-900">
                {isHashtagSearch ? `#${cleanQuery}` : `Results for "${searchQuery}"`}
                <span className="text-gray-300 ml-2">({filteredBooks.length})</span>
              </h3>
            </div>
            {filteredBooks.length > 0 ? (
              <div className="flex overflow-x-auto no-scrollbar gap-6 px-6 pb-4 flex-wrap">
                {filteredBooks.map((b: any) => (
                  <div key={b.id} onClick={() => onSelect(b)} className="flex-shrink-0 w-44 space-y-4 group cursor-pointer transition-all active:scale-95">
                    <div className="aspect-[2/3] rounded-lg shadow-xl border-4 border-white overflow-hidden relative transition-transform group-hover:-translate-y-2" style={{ backgroundColor: b.coverColor }}>
                      <CoverImg book={b} />
                    </div>
                    <div className="px-2 space-y-1">
                      <p className="text-sm font-bold line-clamp-1">{b.title}</p>
                      <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">{b.author.displayName}</p>
                      {b.hashtags?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {b.hashtags.slice(0, 3).map((h: string) => (
                            <span key={h} className="text-[8px] font-bold text-accent/70 bg-accent/5 px-2 py-0.5 rounded-full">#{h}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-gray-300">
                <span className="material-icons-round text-4xl mb-4">search_off</span>
                <p className="text-[10px] font-bold uppercase tracking-widest">No books found</p>
              </div>
            )}
          </section>
        )}

        {/* Star of the wekk Section — only when not searching */}
        {!query && spotlightBook && (
          <section className="px-6">
            <div className="relative group cursor-pointer overflow-hidden rounded-[2.5rem] bg-black shadow-x1 transition-transform active:scale-[0.98]" onClick={() => onSelect(spotlightBook)}>
              <div className="absolute inset-0 opacity-40 blur-3xl scale-100" style={{ backgroundColor: spotlightBook.coverColor }} />
              <div className="relative aspect-[16/10] flex items-center p-8 gap-6 bg-gradient-to-br from-black/60 to-transparent">
                <div className="w-28 h-40 flex-shrink-0 rounded-lg shadow-2xl border-4 border-white/20 transform -rotate-3 transition-transform group-hover:rotate-0 overflow-hidden relative" style={{ backgroundColor: spotlightBook.coverColor }}><CoverImg book={spotlightBook} /></div>
                <div className="space-y-3 flex-1">
                  <div className="inline-block px-3 py-1 bg-accent rounded-full text-[8px] font-bold text-white uppercase tracking-[0.2em] mb-2">STAR OF THE WEEK</div>
                  <h2 className="text-2xl font-display text-white line-clamp-2 leading-tight">{spotlightBook.title}</h2>
                  <p className="text-[11px] text-white/70 font-medium uppercase tracking-widest">By {spotlightBook.author.displayName}</p>
                  <p className="text-xs text-white/50 line-clamp-2 italic">"{spotlightBook.tagline}"</p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Top Authors Section */}
        <section className="space-y-6">
          <div className="px-6 flex justify-between items-center">
            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-900">Top Authors</h3>
          </div>
          <div className="flex overflow-x-auto no-scrollbar gap-6 px-6 pb-2">
            {topAuthors.map((author, i) => (
              <div 
                key={author.user.username} 
                onClick={() => onAuthorSelect(author.user)}
                className="flex-shrink-0 flex flex-col items-center gap-3 group cursor-pointer transition-all active:scale-95 w-24"
              >
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-accent/20 to-accent/5 p-1 ring-2 ring-transparent group-hover:ring-accent transition-all">
                    <div className="w-full h-full rounded-full bg-white flex items-center justify-center text-accent text-xl font-black border-2 border-white shadow-sm overflow-hidden">
                      {author.user.displayName[0]}
                    </div>
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-black rounded-full flex items-center justify-center border-2 border-white shadow-md">
                    <span className="text-[10px] font-black text-white">{i + 1}</span>
                  </div>
                </div>
                <div className="text-center space-y-0.5">
                  <p className="text-[11px] font-bold text-gray-900 leading-tight truncate w-20">{author.user.displayName}</p>
                  <p className="text-[8px] font-bold text-accent uppercase tracking-widest">
                    {author.totalLikes >= 1000 ? (author.totalLikes/1000).toFixed(1) + 'k' : author.totalLikes} Likes
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section Loops — only when not searching */}
        {!query && [
          { title: 'Trending Books', data: trendingBooks },
          { title: 'Recently Read', data: recentlyRead },
          { title: 'Recommended', data: recommendedBooks }
        ].map((section) => {
          // Apply genre filter to section data if genres are selected
          let sectionData = selectedGenres.length > 0
            ? section.data.filter((b: any) => selectedGenres.some(g => (b.genres || []).includes(g)))
            : section.data;
          // Apply sort order
          sectionData = [...sectionData].sort((a: any, b: any) => {
            const dateA = new Date(a.publishedDate).getTime();
            const dateB = new Date(b.publishedDate).getTime();
            return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
          });
          const isExpanded = expandedSections.has(section.title);
          const displayData = isExpanded ? sectionData.slice(0, 20) : sectionData.slice(0, 6);
          return (
          <section key={section.title} className="space-y-6">
            <div className="px-6 flex justify-between items-center">
              <h3 className="text-sm font-bold uppercase tracking-widest text-gray-900">{section.title}</h3>
              {sectionData.length > 6 && (
                <button
                  onClick={() => setExpandedSections(prev => {
                    const next = new Set(prev);
                    if (next.has(section.title)) {
                      next.delete(section.title);
                    } else {
                      next.add(section.title);
                    }
                    return next;
                  })}
                  className="text-[10px] font-bold text-accent uppercase tracking-widest hover:opacity-70 transition-opacity"
                >
                  {isExpanded ? 'Show Less' : 'See All'}
                </button>
              )}
            </div>
            <div className={isExpanded ? "grid grid-cols-5 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-8 gap-3 px-6 pb-4" : "flex overflow-x-auto no-scrollbar gap-6 px-6 pb-4"}>
              {displayData.length > 0 ? displayData.map((b: any) => (
                <div key={b.id} onClick={() => onSelect(b)} className={`${isExpanded ? 'w-full' : 'flex-shrink-0 w-44'} space-y-2 group cursor-pointer transition-all active:scale-95`}>
                  <div className={`aspect-[2/3] ${isExpanded ? 'rounded-lg border-2' : 'rounded-lg border-4'} shadow-xl border-white overflow-hidden relative transition-transform group-hover:-translate-y-2`} style={{ backgroundColor: b.coverColor }}>
                     <CoverImg book={b} />
                     <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                     {b.isExplicit && (
                        <div className="absolute top-4 right-4 bg-red-500/90 backdrop-blur-md px-2 py-0.5 rounded-lg text-[7px] font-bold text-white uppercase tracking-wider">Explicit</div>
                     )}
                     <div className="absolute bottom-4 left-4 right-4 flex justify-between opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0 z-20">
                        <div className="flex items-center gap-1"><span className="material-icons-round text-[10px] text-white">favorite</span><span className="text-[9px] font-bold text-white">{Array.isArray(b.likes) ? b.likes.reduce((a: number, c: number) => a + c, 0) : (b.likes || 0)}</span></div>
                        <div className="flex items-center gap-1"><span className="material-icons-round text-[10px] text-white">chat_bubble</span><span className="text-[9px] font-bold text-white">{b.commentsCount}</span></div>
                     </div>
                  </div>
                  <div className="px-1 space-y-1">
                    <p className="text-[13px] font-bold text-gray-900 leading-tight line-clamp-1">{b.title}</p>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.15em]">{b.author.displayName}</p>
                    <div className="flex gap-1.5 pt-1">
                      {b.genres.slice(0, 2).map((g: string) => (
                        <span key={g} className="text-[8px] font-bold text-accent bg-accent/5 px-2 py-0.5 rounded-md uppercase tracking-wider">{g}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )) : (
                <div className="px-6 py-12 text-center w-full bg-gray-50 rounded-3xl border-2 border-dashed border-gray-100">
                  <span className="material-icons-round text-3xl text-gray-200 mb-3">{section.title === 'Recently Read' ? 'history' : 'auto_stories'}</span>
                  <p className="text-xs text-gray-400 uppercase font-bold tracking-widest">
                    {section.title === 'Recently Read' ? 'Start reading to see history' : 'No stories found yet'}
                  </p>
                </div>
              )}
            </div>
          </section>
        );})}
      </main>
    </div>
  );
};

const OtherProfileView = ({ user, books, onBack, onBookSelect, onAdmire, onBlock, onReport, onMessage, relationships = [], currentUsername = '', readingActivity = {}, avatarConfig = null }: any) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const isAdmiring = relationships.some((r: Relationship) => r.admirer === currentUsername && r.target === user.username);
  const theyAdmireMe = relationships.some((r: Relationship) => r.admirer === user.username && r.target === currentUsername);
  const isMutual = isAdmiring && theyAdmireMe;
  const theirAdmirers = relationships.filter((r: Relationship) => r.target === user.username).length;
  const theirAdmiring = relationships.filter((r: Relationship) => r.admirer === user.username).length;
  const theirMutuals = (() => {
    const admiring = relationships.filter((r: Relationship) => r.admirer === user.username).map((r: Relationship) => r.target);
    return admiring.filter((t: string) => relationships.some((r: Relationship) => r.admirer === t && r.target === user.username)).length;
  })();

  return (
    <div className="fixed inset-0 bg-white overflow-y-auto no-scrollbar pb-32 animate-in slide-in-from-right duration-500">
      <header className="p-6 flex items-center gap-4 sticky top-0 bg-white/80 backdrop-blur-xl z-50">
        <button onClick={onBack} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400">
          <span className="material-icons-round">arrow_back</span>
        </button>
        <h1 className="text-xl font-bold flex-1">Profile</h1>
        <div className="relative">
          <button onClick={() => setShowMenu(!showMenu)} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400">
            <span className="material-icons-round">more_vert</span>
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-12 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50 w-48">
                <button onClick={() => { setShowMenu(false); onReport(); }} className="w-full p-4 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors">
                  <span className="material-icons-round text-sm text-gray-400">flag</span>
                  <span className="text-sm font-bold">Report User</span>
                </button>
                <button onClick={() => { setShowMenu(false); setShowBlockConfirm(true); }} className="w-full p-4 text-left flex items-center gap-3 hover:bg-red-50 transition-colors text-red-500">
                  <span className="material-icons-round text-sm">block</span>
                  <span className="text-sm font-bold">Block User</span>
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Block confirmation modal */}
      {showBlockConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[500] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full space-y-6 animate-in zoom-in-95 duration-300">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
                <span className="material-icons-round text-red-500 text-3xl">block</span>
              </div>
              <h2 className="text-lg font-bold">Block @{user.username}?</h2>
              <p className="text-sm text-gray-400 leading-relaxed">
                They won't be able to see your profile, and you won't see their content, comments, or avatar in the world. You can unblock them later in Settings.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowBlockConfirm(false)} className="flex-1 py-4 rounded-2xl bg-gray-100 text-sm font-bold transition-all active:scale-95">Cancel</button>
              <button onClick={() => { setShowBlockConfirm(false); onBlock(); }} className="flex-1 py-4 rounded-2xl bg-red-500 text-white text-sm font-bold transition-all active:scale-95">Block</button>
            </div>
          </div>
        </div>
      )}
      <div className="p-6 flex flex-col items-center">
        {avatarConfig ? (
          <div className="w-32 h-32 rounded-[3rem] overflow-hidden border-4 border-white shadow-2xl mb-6 relative bg-gray-50">
            <div className="absolute left-1/2" style={{ width: '140px', height: '194px', transform: 'translateX(-50%) scale(2)', transformOrigin: 'top center', top: '8%' }}>
              <img src={getAvatarItemPath('body', avatarConfig.bodyId)} className="absolute inset-0 w-full h-full object-contain" style={{zIndex:1}} />
              {avatarConfig.faceId !== 'no_face' && <img src={getAvatarItemPath('face', avatarConfig.faceId)} className="absolute" style={{zIndex:2, ...getFacePosition(avatarConfig.faceId)}} />}
              <img src={getAvatarItemPath('outfit', avatarConfig.outfitId)} className="absolute inset-0 w-full h-full object-contain" style={{zIndex:3}} />
              {avatarConfig.hairId !== 'none' && <img src={getAvatarItemPath('hair', avatarConfig.hairId)} className="absolute" style={{zIndex:4, ...getHairPosition(avatarConfig.hairId)}} />}
            </div>
          </div>
        ) : (
          <div className="w-32 h-32 rounded-[3rem] bg-gray-50 flex items-center justify-center text-gray-400 text-5xl font-bold mb-6 border-4 border-white shadow-2xl overflow-hidden">
            <span className="material-icons-round text-6xl">person</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{user.displayName}</h1>
          {user.isPremium && <span className="material-icons-round text-pink-500 text-lg">workspace_premium</span>}
        </div>
        <p className="text-xs text-gray-300 font-bold uppercase tracking-widest mb-4">@{user.username}</p>

        {isMutual ? (
          <div className="flex items-center gap-2 mb-10">
            <div className={`w-2 h-2 rounded-full ${user.isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{user.isOnline ? `Online • ${(readingActivity[user.username] || []).length > 0 ? 'Reading' : user.activity}` : 'Offline'}</span>
          </div>
        ) : (
          <div className="mb-10" />
        )}

        <div className="grid grid-cols-3 gap-8 w-full max-w-sm mb-10">
          <div className="text-center">
            <p className="text-lg font-bold">{theirAdmirers}</p>
            <p className="text-[8px] font-bold text-gray-300 uppercase tracking-widest">Admirers</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold">{theirAdmiring}</p>
            <p className="text-[8px] font-bold text-gray-300 uppercase tracking-widest">Admiring</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold">{theirMutuals}</p>
            <p className="text-[8px] font-bold text-gray-300 uppercase tracking-widest">Mutuals</p>
          </div>
        </div>

        <div className="flex gap-3 w-full max-w-sm mb-12">
          {isMutual ? (
            <Button onClick={onAdmire} variant="secondary" className="flex-1"><span className="material-icons-round text-sm">people</span> Mutual</Button>
          ) : (
            <Button onClick={onAdmire} variant={isAdmiring ? 'secondary' : 'primary'} className="flex-1">
              {isAdmiring ? 'Admiring' : 'Admire'}
            </Button>
          )}
          {isMutual && (
            <Button variant="outline" className="flex-1" onClick={onMessage}><span className="material-icons-round text-sm">chat</span> Message</Button>
          )}
        </div>

        <section className="w-full space-y-6 px-4 mb-10">
           {/* Currently Reading — only visible to mutuals */}
           {isMutual ? (() => {
             const activities = readingActivity[user.username] || [];
             const activity = activities.length > 0 ? activities.sort((a: any, b: any) => new Date(b.lastRead).getTime() - new Date(a.lastRead).getTime())[0] : null;
             const readingBook = activity ? books.find((b: Book) => b.id === activity.bookId) : null;
             if (readingBook) {
               const timeSince = (() => {
                 const diff = Date.now() - new Date(activity.lastRead).getTime();
                 const mins = Math.floor(diff / 60000);
                 if (mins < 1) return 'Just now';
                 if (mins < 60) return `${mins}m ago`;
                 const hrs = Math.floor(mins / 60);
                 if (hrs < 24) return `${hrs}h ago`;
                 return `${Math.floor(hrs / 24)}d ago`;
               })();
               return (
                 <>
                   <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">Currently Reading</h3>
                   <button onClick={() => onBookSelect(readingBook)} className="w-full bg-gray-50 p-5 rounded-[2rem] border border-gray-100 flex gap-4 items-center transition-all active:scale-[0.98] hover:border-accent/30 group">
                     <div className="w-14 h-20 rounded-lg overflow-hidden relative flex-shrink-0 shadow-md" style={{ backgroundColor: readingBook.coverColor }}>
                       <CoverImg book={readingBook} />
                     </div>
                     <div className="flex-1 text-left space-y-2">
                       <p className="text-sm font-bold group-hover:text-accent transition-colors">{readingBook.title}</p>
                       <p className="text-[10px] text-gray-400 font-medium">by {readingBook.author.displayName}</p>
                       <div className="flex items-center gap-3">
                         <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                           <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${activity.progress || 0}%` }} />
                         </div>
                         <span className="text-[9px] font-bold text-gray-400">{activity.progress || 0}%</span>
                       </div>
                     </div>
                     <div className="flex flex-col items-end gap-1 flex-shrink-0">
                       <span className="text-[8px] font-bold text-accent uppercase tracking-widest">{timeSince}</span>
                       <span className="material-icons-round text-gray-300 text-sm">chevron_right</span>
                     </div>
                   </button>
                 </>
               );
             }
             return (
               <>
                 <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">Activity</h3>
                 <div className="bg-gray-50 p-6 rounded-[2rem] border border-gray-100 text-center">
                   <span className="material-icons-round text-gray-200 text-3xl mb-2">menu_book</span>
                   <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">Not reading anything right now</p>
                 </div>
               </>
             );
           })() : (
             <>
               <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">Activity</h3>
               <div className="bg-gray-50 p-6 rounded-[2rem] border border-gray-100 text-center">
                 <span className="material-icons-round text-gray-200 text-2xl mb-2">lock</span>
                 <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">Become mutuals to see activity</p>
               </div>
             </>
           )}

          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">Works</h3>
          <div className="flex gap-6 overflow-x-auto no-scrollbar pb-2">
          {/* Filtered to only show published books */}
            {books.filter((b: Book) => b.author.username === user.username && !b.isDraft).map((b: Book) => (
              <div key={b.id} onClick={() => onBookSelect(b)} className="flex-shrink-0 w-32 space-y-2 cursor-pointer transition-transform active:scale-95">
                <div className="aspect-[2/3] rounded-lg shadow-md border-4 border-white overflow-hidden relative" style={{ backgroundColor: b.coverColor }}><CoverImg book={b} /></div>
                <div className="px-1">
                  <p className="text-[10px] font-bold truncate">{b.title}</p>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider truncate">{b.author.displayName}</p>
                </div>
              </div>
            ))}
            {books.filter((b: Book) => b.author.username === user.username && !b.isDraft).length === 0 && (
              <p className="text-[10px] font-bold text-gray-300 uppercase text-center py-10 w-full">No published works yet</p>
            )}
          </div>

          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2 mt-10">Favorites</h3>
          <div className="flex gap-6 overflow-x-auto no-scrollbar pb-2">
            {books.filter((b: Book) => b.isFavorite).map((b: Book) => (
              <div key={b.id} onClick={() => onBookSelect(b)} className="flex-shrink-0 w-32 cursor-pointer space-y-2">
                <div className="aspect-[2/3] rounded-lg shadow-md border-4 border-white overflow-hidden relative" style={{ backgroundColor: b.coverColor }}><CoverImg book={b} /></div>
                <div className="px-1">
                  <p className="text-[10px] font-bold truncate">{b.title}</p>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider truncate">{b.author.displayName}</p>
                </div>
              </div>
            ))}
            {books.filter((b: Book) => b.isFavorite).length === 0 && <p className="text-[10px] font-bold text-gray-300 uppercase py-4">No favorites yet</p>}
          </div>
        </section>
      </div>
    </div>
  );
};

const PublicBookDetailPage = ({ currentUser, book, isOwned, bookProgress, onBack, onRead, onAuthorClick, isLiked, onLike, onSave, onRemove, isSaved, onReport, onShare, onAddToCart, onToggleFavorite, onUnpublish, onDelete, onMarkCompleted}: any) => {
  const isAuthor = currentUser.username === book.author.username;

  
  
  return (
    <div className="fixed inset-0 bg-white overflow-y-auto no-scrollbar pb-32 animate-in slide-in-from-right duration-500">
      <header className="p-6 flex justify-between items-center sticky top-0 z-50 bg-white/80 backdrop-blur-md">
        <button onClick={onBack} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400"><span className="material-icons-round">arrow_back</span></button>
        <div className="flex gap-2">
            <button onClick={onShare} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 transition-colors active:text-accent"><span className="material-icons-round">share</span></button>
            {book.isExplicit && <div className="px-3 py-1 bg-red-500 text-white rounded-full text-[8px] font-bold uppercase tracking-widest flex items-center">Explicit</div>}
          <button 
            onClick={onToggleFavorite} 
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${book.isFavorite ? 'bg-yellow-400/10 text-yellow-500' : 'bg-gray-50 text-gray-300'}`}
          >
            <span className="material-icons-round">{book.isFavorite ? 'star' : 'star_border'}</span>
          </button>  
        </div>
      </header>
      <div className="flex flex-col items-center p-6 text-center">
        <div className="w-56 h-80 rounded-lg shadow-2xl border-4 border-white mb-10 transform -rotate-1 relative overflow-hidden" style={{ backgroundColor: book.coverColor }}>
          <CoverImg book={book} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
        </div>
        <h1 className="text-3xl font-bold mb-2">{book.title}</h1>
        <button onClick={() => onAuthorClick(book.author)} className="text-accent font-bold uppercase text-[10px] tracking-widest mb-6">By {book.author.displayName}</button>
        
        <p className="text-sm text-gray-500 italic mb-8 max-w-sm">"{book.tagline}"</p>
        
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {book.genres.map((g: string) => <span key={g} className="px-3 py-1 bg-gray-50 rounded-full text-[9px] font-bold text-gray-400 uppercase tracking-widest border border-gray-100">{g}</span>)}
        </div>

        <div className="grid grid-cols-3 gap-6 w-full max-w-sm mb-12 border-y border-gray-50 py-8">
          <div className="flex flex-col items-center">
            <p className="text-lg font-bold">{Array.isArray(book.likes) ? book.likes.reduce((a: number, b: number) => a + b, 0) : (book.likes || 0)}</p>
            <p className="text-[9px] text-gray-300 font-bold uppercase">Likes</p>
          </div>
          <div><p className="text-lg font-bold">{book.chaptersCount}</p><p className="text-[9px] text-gray-300 font-bold uppercase">Chapters</p></div>
          <div><p className="text-lg font-bold">{book.commentsCount}</p><p className="text-[9px] text-gray-300 font-bold uppercase">Comments</p></div>
          
        </div>

        <div className="w-full max-w-sm text-left mb-12 space-y-4">
          <div className="flex justify-between items-center"><span className="text-[9px] font-bold text-gray-300 uppercase">Published</span><span className="text-xs font-bold">{book.publishedDate}</span></div>
          <div className="flex justify-between items-center"><span className="text-[9px] font-bold text-gray-300 uppercase">Status</span><span className="text-xs font-bold text-accent">{book.isCompleted ? 'Completed' : 'Ongoing'}</span></div>
          <div className="flex flex-wrap gap-2 mt-4">{book.hashtags.map((h: string) => <span key={h} className="text-[10px] text-accent font-bold">#{h}</span>)}</div>
        </div>

 {/* Management Buttons for Author */}
        {isAuthor && (
          <div className="w-full max-w-sm grid grid-cols-3 gap-3 mb-8">
            <button 
              onClick={() => onUnpublish(book.id)} 
              className="flex flex-col items-center gap-2 p-4 bg-gray-50 rounded-2xl border border-gray-100 hover:bg-gray-100 transition-colors"
            >
              <span className="material-icons-round text-gray-400">visibility_off</span>
              <span className="text-[8px] font-bold uppercase text-gray-400">Unpublish</span>
            </button>
            <button
              onClick={() => onMarkCompleted(book.id)}
              className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-colors ${book.isCompleted ? 'bg-green-50 border-green-200 hover:bg-green-100' : 'bg-gray-50 border-gray-100 hover:bg-gray-100'}`}
            >
              <span className={`material-icons-round ${book.isCompleted ? 'text-green-500' : 'text-accent'}`}>{book.isCompleted ? 'check_circle' : 'radio_button_unchecked'}</span>
              <span className={`text-[8px] font-bold uppercase ${book.isCompleted ? 'text-green-500' : 'text-accent'}`}>{book.isCompleted ? 'Completed' : 'Complete'}</span>
            </button>
            <button 
              onClick={() => onDelete(book.id)} 
              className="flex flex-col items-center gap-2 p-4 bg-red-50 rounded-2xl border border-red-100 hover:bg-red-100 transition-colors"
            >
              <span className="material-icons-round text-red-500">delete_forever</span>
              <span className="text-[8px] font-bold uppercase text-red-500">Delete</span>
            </button>
          </div>
        )}

        <div className="w-full max-w-sm space-y-3">
          {isOwned || isAuthor || book.isFree || !book.isMonetized ? (
            <Button className="w-full" onClick={onRead}><span className="material-icons-round text-sm">auto_stories</span> {bookProgress > 0 ? 'Continue' : 'Read'}</Button>
          ) : (
            <div className="flex gap-2">
              <Button className="flex-1" onClick={onRead}><span className="material-icons-round text-sm">auto_stories</span> Preview</Button>
              <Button variant="secondary" className="flex-1" onClick={onAddToCart}><span className="material-icons-round text-sm">add_shopping_cart</span> Add to Cart (${(book.price || 9.99).toFixed(2)})</Button>
            </div>
          )}
          {/* Library button depends strictly on isOwned (visibility in Library tab) */}
          {!isAuthor && (
          <Button
            variant={isOwned ? "destructive" : "outline"}
            className={`w-full ${isOwned ? 'bg-transparent border-none shadow-none text-gray-400' : ''}`}
            onClick={() => isOwned ? onRemove(book.id) : onSave(book.id)}
          >
            <span className="material-icons-round text-sm">{isOwned ? 'remove_circle_outline' : 'bookmark_add'}</span>
            {isOwned ? 'Remove from Library' : 'Save to Library'}
          </Button>
          )}
          <Button variant="destructive" className="w-full bg-transparent border-none shadow-none" onClick={onReport}><span className="material-icons-round text-sm">report</span> Report</Button>
          </div>
        </div>
      </div>
  );
};

  const CartView = ({ cart, setCart, coupons, setCoupons, onBack, onOwnedUpdate, showToast, showConfirm }: any) => {
  const [selectedCoupon, setSelectedCoupon] = useState<Coupon | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const subtotal = cart.reduce((acc: number, item: any) => acc + (item.price || 9.99), 0);
  const discount = selectedCoupon ? selectedCoupon.value : 0;
  const total = Math.max(0, subtotal - discount);

  const handleRemove = (bookId: string) => {
    setCart(cart.filter((b: any) => b.id !== bookId));
  };

  // Listen for successful payment return from Stripe
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('payment_success') === 'true') {
      // Payment was successful - mark items as owned
      const purchasedIds = JSON.parse(localStorage.getItem('mainwrld_pending_purchase') || '[]');
      const couponId = localStorage.getItem('mainwrld_pending_coupon');
      purchasedIds.forEach((id: string) => onOwnedUpdate(id));
      if (couponId) {
        // Remove used coupon from array entirely
        setCoupons((prev: any[]) => prev.filter((c: any) => c.id !== couponId));
      }
      localStorage.removeItem('mainwrld_pending_purchase');
      localStorage.removeItem('mainwrld_pending_coupon');
      setCart([]);
      showToast('Purchase complete! Books added to library.', 'check_circle');
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleCheckout = async () => {
    if (cart.length === 0) return;

    if (total === 0) {
      // Free checkout (fully covered by coupon)
      cart.forEach((b: any) => onOwnedUpdate(b.id));
      if (selectedCoupon) {
      // Logic: Once used, remove the coupon ticket from its slot in the array.
      setCoupons(coupons.filter((c: any) => c.id !== selectedCoupon.id));
    }
      setCart([]);
      showToast('Books added to library!', 'check_circle');
      onBack();
      return;
    }

    setIsProcessing(true);
    try {
      const stripe = getStripe();
      if (!stripe || STRIPE_PUBLISHABLE_KEY.includes('REPLACE')) {
        // Stripe not configured yet - use in-app confirmation
        showConfirm({
          title: 'Complete Purchase',
          message: `Buy ${cart.length} book(s) for $${total.toFixed(2)}?`,
          confirmLabel: 'Purchase',
          icon: 'shopping_cart',
          onConfirm: () => {
            cart.forEach((b: any) => onOwnedUpdate(b.id));
            if (selectedCoupon) {
              // Remove used coupon from array entirely
              setCoupons(coupons.filter((c: any) => c.id !== selectedCoupon.id));
            }
            setCart([]);
            showToast('Purchase complete! Books added to library.', 'check_circle');
            onBack();
          },
        });
        setIsProcessing(false);
        return;
      }

      // Store pending purchase info for when user returns from Stripe
      localStorage.setItem('mainwrld_pending_purchase', JSON.stringify(cart.map((b: any) => b.id)));
      if (selectedCoupon) {
        localStorage.setItem('mainwrld_pending_coupon', selectedCoupon.id);
      }

      // Use Stripe Checkout with Price ID if available, otherwise use line items
      if (STRIPE_BOOK_PRICE_ID) {
        const { error } = await stripe.redirectToCheckout({
          lineItems: [{ price: STRIPE_BOOK_PRICE_ID, quantity: cart.length }],
          mode: 'payment',
          successUrl: `${window.location.origin}?payment_success=true`,
          cancelUrl: `${window.location.origin}?payment_cancelled=true`,
        });
        if (error) {
          console.error('Stripe error:', error);
          showToast('Payment failed. Please try again.', 'error');
        }
      } else {
        // Fallback: use in-app confirmation
        showConfirm({
          title: 'Complete Purchase',
          message: `Pay $${total.toFixed(2)} for ${cart.length} book(s)?`,
          confirmLabel: 'Pay Now',
          icon: 'shopping_cart',
          onConfirm: () => {
            cart.forEach((b: any) => onOwnedUpdate(b.id));
            if (selectedCoupon) {
              // Remove used coupon from array entirely
              setCoupons(coupons.filter((c: any) => c.id !== selectedCoupon.id));
            }
            setCart([]);
            showToast('Purchase complete! Books added to library.', 'check_circle');
            onBack();
          },
        });
      }
    } catch (err) {
      console.error('Checkout error:', err);
      showToast('Payment service unavailable. Please try again later.', 'error');
    }
    setIsProcessing(false);
  };

  return (
    <div className="fixed inset-0 bg-white overflow-y-auto no-scrollbar pb-32 animate-in slide-in-from-right duration-500 z-[400]">
      <header className="p-6 flex items-center gap-4 sticky top-0 bg-white/80 backdrop-blur-xl z-50">
        <button onClick={onBack} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400">
          <span className="material-icons-round">arrow_back</span>
        </button>
        <h1 className="text-xl font-bold">Shopping Cart</h1>
      </header>

      <div className="p-6 space-y-8">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-300">
            <span className="material-icons-round text-6xl mb-4">shopping_cart</span>
            <p className="text-xs font-bold uppercase tracking-widest">Cart is empty</p>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {cart.map((book: any) => (
                <div key={book.id} className="p-4 bg-gray-50 rounded-2xl flex gap-4 border border-gray-100">
                  <div className="w-16 h-24 rounded-lg flex-shrink-0" style={{ backgroundColor: book.coverColor }} />
                  <div className="flex-1 flex flex-col justify-between py-1">
                    <div>
                      <h3 className="text-sm font-bold truncate">{book.title}</h3>
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">By {book.author.displayName}</p>
                    </div>
                    <div className="flex justify-between items-end">
                      <p className="text-sm font-black text-accent">${(book.price || 9.99).toFixed(2)}</p>
                      <button onClick={() => handleRemove(book.id)} className="text-[9px] font-bold text-gray-400 uppercase">Remove</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-2">Apply Coupon</h3>
              <div className="flex gap-3 overflow-x-auto no-scrollbar">
                {coupons.filter((c: any) => !c.used).length === 0 ? (
                  <p className="text-[9px] italic text-gray-400 ml-2">No coupons available. Win them in Daily Rewards!</p>
                ) : (
                  coupons.filter((c: any) => !c.used).map((c: any) => (
                    <button 
                      key={c.id} 
                      onClick={() => setSelectedCoupon(selectedCoupon?.id === c.id ? null : c)}
                      className={`flex-shrink-0 px-4 py-3 rounded-xl border-2 transition-all ${selectedCoupon?.id === c.id ? 'bg-accent border-accent text-white' : 'bg-gray-50 border-gray-100 text-gray-400'}`}
                    >
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-black">${c.value}</span>
                        <span className="text-[7px] font-bold uppercase">Off</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="p-6 bg-gray-50 rounded-3xl space-y-3 border border-gray-100">
              <div className="flex justify-between text-xs font-bold text-gray-400"><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between text-xs font-bold text-accent"><span>Coupon Discount</span><span>-${discount.toFixed(2)}</span></div>
              <div className="pt-3 border-t border-gray-200 flex justify-between text-lg font-black"><span>Total</span><span>${total.toFixed(2)}</span></div>
            </div>

            <Button className="w-full h-16 shadow-2xl shadow-accent/20" onClick={handleCheckout} disabled={isProcessing}>
              {isProcessing ? (
                <span className="flex items-center gap-2"><span className="material-icons-round animate-spin text-sm">sync</span> Processing...</span>
              ) : (
                <span className="flex items-center gap-2"><span className="material-icons-round text-sm">lock</span> Checkout & Pay ${total.toFixed(2)}</span>
              )}
            </Button>
            <p className="text-[8px] text-gray-400 text-center font-bold uppercase tracking-widest flex items-center justify-center gap-1">
              <span className="material-icons-round text-[10px]">lock</span> Secured by Stripe
            </p>
          </>
        )}
      </div>
    </div>
  );
};
  
// Render formatted content (markdown-like syntax and HTML tags)
const renderFormattedContent = (content: string) => {
  if (!content) return null;
  // Convert markdown-like syntax to HTML
  let html = content
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') // **bold**
    .replace(/\*(.+?)\*/g, '<em>$1</em>') // *italic*
    .replace(/• /g, '&bull; '); // bullet points
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
};

// Ad banner shown at end of chapters (skipped for premium users)
const ChapterAdBanner = ({ isPremium = false, inverted = false }: { isPremium?: boolean; inverted?: boolean }) => {
  if (isPremium) return null;

  // Placeholder ad slot — replace with Google AdSense or ad network script
  return (
    <div className={`my-10 p-6 rounded-3xl border-2 border-dashed text-center space-y-3 ${inverted ? 'border-gray-700 bg-gray-900/50' : 'border-gray-200 bg-gray-50'}`}>
      <div className={`text-[8px] font-bold uppercase tracking-[0.3em] ${inverted ? 'text-gray-500' : 'text-gray-300'}`}>
        Advertisement
      </div>
      <div className={`h-24 rounded-2xl flex items-center justify-center ${inverted ? 'bg-gray-800' : 'bg-gray-100'}`}>
        {/* Google AdSense or ad network slot goes here */}
        {/* <ins className="adsbygoogle" data-ad-client="ca-pub-XXXX" data-ad-slot="XXXX" data-ad-format="auto" /> */}
        <div className={`text-center ${inverted ? 'text-gray-600' : 'text-gray-300'}`}>
          <span className="material-icons-round text-2xl mb-1">campaign</span>
          <p className="text-[9px] font-bold uppercase tracking-widest">Ad Space</p>
        </div>
      </div>
      <p className={`text-[7px] font-bold uppercase tracking-widest ${inverted ? 'text-gray-600' : 'text-gray-300'}`}>
        Support the author • <span className="text-accent cursor-pointer">Go Premium</span> to remove ads
      </p>
    </div>
  );
};

const ReadingView = ({ currentUser, book, initialScrollProgress, initialChapterIndex, settings, setSettings, onBack, onComments, likedChapters, onLike, onSave, isSaved, canSave, onProgressUpdate, onShare, chapterCommentsCount }: any) => {
  const [showOptions, setShowOptions] = useState(false);
  const [currentChapterIdx, setCurrentChapterIdx] = useState(initialChapterIndex || 0);
  const [localScrollProgress, setLocalScrollProgress] = useState(initialScrollProgress || 0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageFlipRef = useRef<HTMLDivElement>(null);
 const touchStartRef = useRef(0);

  // Prevent copy/paste and screenshots in reading view
  useEffect(() => {
    const preventCopy = (e: Event) => e.preventDefault();
    const preventKeys = (e: KeyboardEvent) => {
      // Block Print Screen, Ctrl+C, Ctrl+A, Ctrl+P, Cmd+C, Cmd+A, Cmd+P
      if (e.key === 'PrintScreen' || ((e.ctrlKey || e.metaKey) && ['c','a','p','s'].includes(e.key.toLowerCase()))) {
        e.preventDefault();
      }
    };
    document.addEventListener('copy', preventCopy);
    document.addEventListener('cut', preventCopy);
    document.addEventListener('keydown', preventKeys);
    document.addEventListener('contextmenu', preventCopy);
    return () => {
      document.removeEventListener('copy', preventCopy);
      document.removeEventListener('cut', preventCopy);
      document.removeEventListener('keydown', preventKeys);
      document.removeEventListener('contextmenu', preventCopy);
    };
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!settings.scrollMode) return;
    const target = e.currentTarget;
    const progress = Math.round((target.scrollTop / (target.scrollHeight - target.clientHeight)) * 100);
    setLocalScrollProgress(progress);
  };

  const handlePageFlipScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (settings.scrollMode) return;
    const target = e.currentTarget;
    const progress = Math.round((target.scrollLeft / (target.scrollWidth - target.clientWidth)) * 100);
    setLocalScrollProgress(progress);
  };

  const isAuthor = currentUser?.username === book?.author?.username;
  const isOwned = book?.isOwned;
  const isFreeOrUnmonetized = book?.isFree || !book?.isMonetized;
  const canAccessAll = isAuthor || isOwned || isFreeOrUnmonetized;

  const allChapters = book?.chapters || [];
  // Author sees all chapters (including drafts), others with access see only published chapters, non-access users see only first chapter (preview)
  const visibleChapters = isAuthor ? allChapters : (canAccessAll ? allChapters.slice(0, book?.chaptersCount || allChapters.length) : allChapters.slice(0, 1));
  const currentChapter = visibleChapters[currentChapterIdx] || { title: book?.title, content: book?.content };

  const handleForward = () => {
    if (!settings.scrollMode && pageFlipRef.current) {
        const maxScroll = pageFlipRef.current.scrollWidth - pageFlipRef.current.clientWidth;
        if (pageFlipRef.current.scrollLeft >= maxScroll - 10) {
            if (currentChapterIdx < visibleChapters.length - 1) {
                setCurrentChapterIdx(prev => prev + 1);
                pageFlipRef.current.scrollLeft = 0;
            }
        } else {
            pageFlipRef.current.scrollLeft += pageFlipRef.current.clientWidth;
        }
    } else if (containerRef.current) {
        containerRef.current.scrollTop += 300;
    }
  };

  const handleBackward = () => {
    if (!settings.scrollMode && pageFlipRef.current) {
        if (pageFlipRef.current.scrollLeft <= 10) {
            if (currentChapterIdx > 0) {
                setCurrentChapterIdx(prev => prev - 1);
            }
        } else {
            pageFlipRef.current.scrollLeft -= pageFlipRef.current.clientWidth;
        }
    } else if (containerRef.current) {
        containerRef.current.scrollTop -= 300;
    }
  };

  const touchStartYRef = useRef(0);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchEnd = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchStartRef.current - touchEnd;
    const diffY = Math.abs(touchStartYRef.current - touchEndY);
    // Only trigger on primarily horizontal swipes (ignore vertical scrolling)
    if (Math.abs(diffX) > 50 && Math.abs(diffX) > diffY) {
      if (diffX > 0) handleForward();
      else handleBackward();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'p') handleForward();
      if (key === 'o') handleBackward();
      // Block common screenshot and dev tools shortcuts
      if (
        (e.ctrlKey && (key === 'p' || key === 's' || key === 'u')) ||
        (e.metaKey && (key === 'p' || key === 's' || key === 'u')) ||
        (e.metaKey && e.shiftKey && (key === '3' || key === '4' || key === '5')) ||
        e.key === 'PrintScreen' ||
        e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && (key === 'i' || key === 'j' || key === 'c')) ||
        (e.metaKey && e.altKey && (key === 'i' || key === 'j' || key === 'c'))
      ) {
        e.preventDefault();
        return false;
      }
    };
    const preventDefault = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('contextmenu', preventDefault);
    document.addEventListener('copy', preventDefault);
    document.addEventListener('cut', preventDefault);
    document.addEventListener('selectstart', preventDefault);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('contextmenu', preventDefault);
      document.removeEventListener('copy', preventDefault);
      document.removeEventListener('cut', preventDefault);
      document.removeEventListener('selectstart', preventDefault);
    };
  }, [handleForward, handleBackward]);

  // Restore scroll position when component mounts or chapter changes
  useEffect(() => {
    const restoreScroll = () => {
      if (settings.scrollMode && containerRef.current) {
        const scrollHeight = containerRef.current.scrollHeight - containerRef.current.clientHeight;
        const targetScroll = (initialScrollProgress / 100) * scrollHeight;
        containerRef.current.scrollTop = targetScroll;
      } else if (!settings.scrollMode && pageFlipRef.current) {
        const scrollWidth = pageFlipRef.current.scrollWidth - pageFlipRef.current.clientWidth;
        const targetScroll = (initialScrollProgress / 100) * scrollWidth;
        pageFlipRef.current.scrollLeft = targetScroll;
      }
    };
    // Small delay to ensure content is rendered before scrolling
    const timer = setTimeout(restoreScroll, 100);
    return () => clearTimeout(timer);
  }, [initialScrollProgress, settings.scrollMode]);

  // Sync progress back to main state when it changes significantly (save both scroll and chapter)
  useEffect(() => {
    onProgressUpdate(localScrollProgress, currentChapterIdx);
  }, [localScrollProgress, currentChapterIdx, onProgressUpdate]);

  // Scroll to top when chapter changes (skip initial mount to allow restore)
  const chapterChangeRef = useRef(false);
  useEffect(() => {
    if (!chapterChangeRef.current) {
      chapterChangeRef.current = true;
      return; // Skip initial mount — let the scroll restore handle it
    }
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
    if (pageFlipRef.current) {
      pageFlipRef.current.scrollLeft = 0;
    }
    setLocalScrollProgress(0);
  }, [currentChapterIdx]);

  return (
    <div className={`fixed inset-0 animate-in fade-in duration-500 overflow-hidden flex flex-col ${settings.inverted ? 'bg-black text-white' : 'bg-white text-black'}`}>
      <header className={`p-6 flex justify-between items-center z-[100] ${settings.inverted ? 'bg-black/80' : 'bg-white/80'} backdrop-blur-md border-b ${settings.inverted ? 'border-gray-800' : 'border-gray-50'}`}>
        <button onClick={onBack} className="w-10 h-10 opacity-40"><span className="material-icons-round">close</span></button>
        
        <div className="flex-1 px-4 flex flex-col items-center">
            <select 
                value={currentChapterIdx} 
                onChange={(e) => { setCurrentChapterIdx(parseInt(e.target.value)); setLocalScrollProgress(0); }}
                className={`text-[10px] font-bold uppercase tracking-widest bg-transparent outline-none border-b border-accent/40 pb-1 max-w-[200px] text-center cursor-pointer mb-2 ${settings.inverted ? 'text-white' : 'text-black'}`}
                disabled={!canAccessAll}
            >
                {visibleChapters.length > 0 ? visibleChapters.map((ch: any, i: number) => (
                    <option key={i} value={i} className={settings.inverted ? 'bg-gray-900 text-white' : 'bg-white text-black'}>{ch.title || `Chapter ${i + 1}`}{isAuthor && i >= (book?.chaptersCount || 0) ? ' (Draft)' : ''}</option>
                )) : <option value={0}>{book?.title || 'Story'}</option>}
            </select>
            <div className="w-full max-w-[120px] h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-accent transition-all duration-300" style={{ width: `${localScrollProgress}%` }}></div>
            </div>
        </div>

        <div className="flex items-center gap-1">
            <button onClick={onShare} className="w-10 h-10 opacity-40"><span className="material-icons-round">share</span></button>
            <button onClick={() => setShowOptions(!showOptions)} className="w-10 h-10 opacity-40"><span className="material-icons-round">settings</span></button>
        </div>
      </header>
      
      {showOptions && (
        <div className={`fixed top-24 right-6 w-64 p-6 rounded-3xl shadow-2xl z-[110] border ${settings.inverted ? 'bg-gray-900 border-gray-800 text-white' : 'bg-white border-gray-100 text-black'}`}>
          <div className="space-y-6">
            <div><p className="text-[9px] font-bold uppercase opacity-40 mb-3">Font Size ({settings.fontSize}px)</p><input type="range" min="10" max="18" value={settings.fontSize} onChange={(e) => setSettings({...settings, fontSize: parseInt(e.target.value)})} className="w-full accent-accent" /></div>
            <div className="flex justify-between items-center"><p className="text-[10px] font-bold uppercase">Invert Colors</p><input type="checkbox" checked={settings.inverted} onChange={() => setSettings({...settings, inverted: !settings.inverted})} className="accent-accent" /></div>
            <div className="flex justify-between items-center"><p className="text-[10px] font-bold uppercase">Scroll Mode</p><input type="checkbox" checked={settings.scrollMode} onChange={() => setSettings({...settings, scrollMode: !settings.scrollMode})} className="accent-accent" /></div>
          </div>
        </div>
      )}

      {settings.scrollMode ? (
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto no-scrollbar p-8 pt-10"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            <div className="max-w-2xl mx-auto space-y-10 mb-20 reader-content select-none" style={{ fontSize: `${settings.fontSize}px`, WebkitUserSelect: 'none', userSelect: 'none' }}>
                {!canAccessAll && (
                  <div className="p-4 mb-10 bg-accent/10 border border-accent/20 rounded-2xl text-center">
                    <p className="text-[10px] font-bold text-accent uppercase tracking-[0.2em]">Preview Mode</p>
                    <p className="text-[8px] font-medium text-accent/60 uppercase mt-1">Purchase the full work to unlock all chapters.</p>
                  </div>
                )}
                <h1 className="text-3xl font-bold text-center mb-12">{currentChapter.title}</h1>
                <div className="leading-relaxed whitespace-pre-line text-justify">{renderFormattedContent(currentChapter.content)}</div>
                <ChapterAdBanner isPremium={currentUser?.isPremium} inverted={settings.inverted} />
                {/* Chapter navigation buttons for scroll mode */}
                {visibleChapters.length > 1 && (
                  <div className="flex justify-between items-center pt-8 pb-4">
                    <button
                      onClick={() => { if (currentChapterIdx > 0) { setCurrentChapterIdx(prev => prev - 1); if (containerRef.current) containerRef.current.scrollTop = 0; } }}
                      disabled={currentChapterIdx === 0}
                      className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest ${currentChapterIdx === 0 ? 'opacity-20' : 'opacity-60'} ${settings.inverted ? 'text-white' : 'text-black'}`}
                    >
                      ← Previous
                    </button>
                    <span className={`text-[9px] font-bold uppercase tracking-widest opacity-30 ${settings.inverted ? 'text-white' : 'text-black'}`}>
                      {currentChapterIdx + 1} / {visibleChapters.length}
                    </span>
                    <button
                      onClick={() => { if (currentChapterIdx < visibleChapters.length - 1) { setCurrentChapterIdx(prev => prev + 1); if (containerRef.current) containerRef.current.scrollTop = 0; } }}
                      disabled={currentChapterIdx >= visibleChapters.length - 1}
                      className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest ${currentChapterIdx >= visibleChapters.length - 1 ? 'opacity-20' : 'opacity-60'} ${settings.inverted ? 'text-white' : 'text-black'}`}
                    >
                      Next →
                    </button>
                  </div>
                )}
            </div>
          </div>
      ) : (
          <div
            className="flex-1 overflow-hidden relative"
          >
              {!canAccessAll && (
                <div className="absolute top-4 left-4 right-4 p-4 bg-accent/10 border border-accent/20 rounded-2xl text-center z-20">
                  <p className="text-[10px] font-bold text-accent uppercase tracking-[0.2em]">Preview Mode</p>
                  <p className="text-[8px] font-medium text-accent/60 uppercase mt-1">Purchase the full work to unlock all chapters.</p>
                </div>
              )}
              <div
                ref={pageFlipRef}
                className="page-flip-container no-scrollbar h-full w-full overflow-x-auto snap-x snap-mandatory"
                onScroll={handlePageFlipScroll}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                  <div className="page-flip-content reader-content h-full p-8 pt-10" style={{ fontSize: `${settings.fontSize}px`, columnWidth: 'calc(100vw - 64px)', columnGap: '64px' }}>
                      <h1 className="text-3xl font-bold mb-12 pt-10">{currentChapter.title}</h1>
                      <div className="leading-relaxed whitespace-pre-line text-justify">{renderFormattedContent(currentChapter.content)}</div>
                      <ChapterAdBanner isPremium={currentUser?.isPremium} inverted={settings.inverted} />
                  </div>
              </div>
          </div>
      )}

      <div className="max-w-2xl mx-auto border-t border-gray-100 py-12 flex flex-col items-center gap-10">
        <div className="flex items-center gap-12">
              {(() => {
                const chapterLikeKey = `${book?.id}:${currentChapterIdx}`;
                const chapterIsLiked = likedChapters?.has(chapterLikeKey) || false;
                const chapterLikesArr = Array.isArray(book?.likes) ? book.likes : [book?.likes || 0];
                const chapterLikesCount = chapterLikesArr[currentChapterIdx] || 0;
                return (
                  <button onClick={() => onLike(currentChapterIdx)} className="flex flex-col items-center gap-1 transition-all active:scale-90">
                    <span className={`material-icons-round text-2xl ${chapterIsLiked ? 'text-accent' : 'text-gray-400'}`}>thumb_up</span>
                    <span className={`text-[9px] font-bold uppercase ${chapterIsLiked ? 'text-accent' : 'text-gray-400'}`}>Like</span>
                    <span className={`text-[9px] font-bold ${chapterIsLiked ? 'text-accent' : 'text-gray-400'}`}>{chapterLikesCount}</span>
                  </button>
                );
              })()}
              <button onClick={() => onComments(currentChapterIdx)} className="flex flex-col items-center gap-1 transition-all active:scale-90">
                  <span className="material-icons-round text-2xl text-gray-400">chat_bubble</span>
                  <span className="text-[9px] font-bold uppercase text-gray-400">Comment</span>
                  <span className="text-[9px] font-bold text-gray-400">{chapterCommentsCount || 0}</span>
              </button>
              {canSave && (
              <button onClick={onSave} className="flex flex-col items-center gap-1 transition-all active:scale-90">
                  <span className={`material-icons-round text-2xl ${isSaved ? 'text-accent' : 'text-gray-400'}`}>{isSaved ? 'bookmark' : 'bookmark_border'}</span>
                  <span className={`text-[9px] font-bold uppercase ${isSaved ? 'text-accent' : 'text-gray-400'}`}>Save</span>
              </button>
              )}
          </div>
          {/* Chapter navigation */}
          <div className="flex items-center gap-6">
            {currentChapterIdx > 0 && (
                <button onClick={() => setCurrentChapterIdx(prev => prev - 1)} className="flex items-center gap-1 text-gray-400 hover:text-gray-600 transition-colors">
                    <span className="material-icons-round text-sm">keyboard_arrow_left</span>
                    <span className="text-[9px] font-bold uppercase">Prev Chapter</span>
                </button>
            )}
            {currentChapterIdx < visibleChapters.length - 1 && (
                <button onClick={() => setCurrentChapterIdx(prev => prev + 1)} className="flex items-center gap-1 text-gray-400 hover:text-gray-600 transition-colors">
                    <span className="text-[9px] font-bold uppercase">Next Chapter</span>
                    <span className="material-icons-round text-sm">keyboard_arrow_right</span>
                </button>
            )}
          </div>
      </div>
    </div>
  );
};

const MonetizationRequestView = ({ works, onBack, onRequest, showToast}: any) => {
  const [selectedBook, setSelectedBook] = useState(works[0] || null);
  const [price, setPrice] = useState('9.99');

  const eligibility = useMemo(() => {
    if (!selectedBook) return { met: false, reasons: ['No works selected'] };
    const r = [];
    if (!selectedBook.isCompleted) r.push('Mark as complete');
    if (selectedBook.chaptersCount < 5) r.push('At least 5 published chapters');
    if ((selectedBook.minLikesPerChapter || 0) < 50) r.push('50+ likes per published chapter');

    // 21 days logic
    const publishedDate = new Date(selectedBook.publishedDate);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - publishedDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays < 21) r.push(`Published for at least 21 days (Current: ${diffDays} days)`);

    if (selectedBook.wasMonetizedBefore) r.push('Already successfully monetized before unpublishing (Cannot re-monetize)');
    if ((selectedBook.monetizationAttempts || 0) >= 2) r.push('Maximum 2 attempts reached');

    return { met: r.length === 0, reasons: r };

  }, [selectedBook]);

  return (
    <div className="fixed inset-0 bg-white overflow-y-auto p-6 animate-in slide-in-from-bottom duration-500 z-[300]">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Monetize (coming soon)</h1>
        <button onClick={onBack} className="w-10 h-10 text-gray-300"><span className="material-icons-round">close</span></button>
      </header>
      <div className="space-y-8 pb-32">
        <div className="p-5 bg-accent/5 rounded-3xl border border-accent/10">
          <p className="text-[10px] font-bold text-accent uppercase tracking-widest leading-relaxed">
            Note: You have a maximum of 2 monetization attempts per book. If a book was successfully monetized and subsequently unpublished, it cannot be monetized a second time.
          </p>
          </div>
      
        <section className="space-y-4">
          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-2">Select Work</label>
          <div className="flex gap-4 overflow-x-auto no-scrollbar">
            {works.map((b: Book) => (
              <button key={b.id} onClick={() => setSelectedBook(b)} className={`w-24 flex-shrink-0 transition-all ${selectedBook?.id === b.id ? 'scale-105 opacity-100' : 'opacity-40'}`}>
                <div className="aspect-[2/3] rounded-lg mb-2 overflow-hidden relative" style={{ backgroundColor: b.coverColor }}><CoverImg book={b} /></div>
                <p className="text-[10px] font-bold truncate">{b.title}</p>
              </button>
            ))}
          </div>
        </section>

        {selectedBook && !eligibility.met && (
          <div className="p-6 bg-red-50 rounded-3xl border border-red-100">
            <h3 className="text-xs font-bold text-red-500 uppercase tracking-widest mb-3">Ineligible</h3>
            <ul className="space-y-2">
              {eligibility.reasons.map((r: string) => <li key={r} className="text-[10px] text-red-400 font-bold flex items-center gap-2"><span className="material-icons-round text-xs">close</span> {r}</li>)}
            </ul>
          </div>
        )}

        <section className={`space-y-6 ${!eligibility.met ? 'opacity-30 pointer-events-none' : ''}`}>
          <div className="space-y-2">
            <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-2">Pricing Option</label>
            <div className="grid grid-cols-3 gap-2">
              {['9.99', '14.99', '19.99', '24.99', '29.99'].map(p => (
                <button key={p} onClick={() => setPrice(p)} className={`py-3 rounded-xl border text-[10px] font-bold ${price === p ? 'bg-accent text-white border-accent shadow-lg' : 'bg-white border-gray-100 text-gray-400'}`}>${p}</button>
              ))}
            </div>
          </div>
          <div className="p-6 bg-gray-50 rounded-3xl space-y-4 border border-gray-100">
            <h4 className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Revenue Split</h4>
            <div className="flex justify-between text-xs font-bold"><span>Cash Sales</span><span className="text-accent">80%</span></div>
          </div>
          <Button className="w-full h-16" onClick={() => { 
            onRequest(selectedBook.id);
            showToast('Feature coming soon!', 'send'); 
            onBack(); }}>Send Request</Button>
        </section>
      </div>
    </div>
  );
};

const PublishingView = ({ initialData, onPost, onBack, isNewBook}: any) => {
  const [tagline, setTagline] = useState(initialData?.tagline ||'');
  const [isExplicit, setIsExplicit] = useState(initialData?.isExplicit || false);
  const [commentsEnabled, setCommentsEnabled] = useState(initialData?.commentsEnabled !== false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>(initialData?.genres ||[]);
  const [hashtags, setHashtags] = useState(initialData?.hashtags?.join(', ') ||'');
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleGenre = (genre: string) => {
    setSelectedGenres(prev =>
      prev.includes(genre) ? prev.filter(g => g !== genre) : (prev.length < 2 ? [...prev, genre] : [prev[1], genre])
    );
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCoverImage(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 bg-white overflow-y-auto p-6 animate-in slide-in-from-right duration-500 z-[300]">
      <header className="flex justify-between items-center mb-10">
        <h1 className="text-2xl font-bold">{isNewBook ? 'Publish' : 'Add Chapter'}</h1>
        <button onClick={onBack} className="w-10 h-10 text-gray-300"><span className="material-icons-round">close</span></button>
      </header>
      <div className="space-y-8 pb-32">
        
            <section className="space-y-4">
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-2">Cover Image</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleCoverUpload}
                className="hidden"
              />
              {coverImage ? (
                <div className="relative w-40 aspect-[2/3] rounded-3xl overflow-hidden shadow-lg border-4 border-white group">
                  <img src={coverImage} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-white rounded-xl text-[9px] font-bold uppercase">Change</button>
                  </div>
                  <button
                    onClick={() => setCoverImage(null)}
                    className="absolute top-2 right-2 w-7 h-7 bg-black/50 text-white rounded-full flex items-center justify-center"
                  >
                    <span className="material-icons-round text-sm">close</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-40 aspect-[2/3] bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-300 gap-2 cursor-pointer hover:border-accent hover:text-accent transition-colors"
                >
                  <span className="material-icons-round">add_photo_alternate</span>
                  <span className="text-[9px] font-bold uppercase">Upload</span>
                </button>
              )}
            </section>

            <Input label="Tagline" maxLength={200} value={tagline} onChange={setTagline} placeholder="A short, catchy hook..." description="Max 200 characters" />

            <div className="space-y-2.5">
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-2">Genres (Select up to 2)</label>
              <div className="flex flex-wrap gap-2">
                {GENRE_LIST.map(g => (
                  <button
                    key={g}
                    onClick={() => toggleGenre(g)}
                    className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase border transition-all ${selectedGenres.includes(g) ? 'bg-accent text-white border-accent' : 'bg-gray-50 text-gray-400 border-gray-100'}`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <Input
              label="Hashtags"
              placeholder="cyberpunk, dystopia, neon"
              value={hashtags}
              onChange={setHashtags}
              description="Separate with commas"
            />
          
        

        <div className="space-y-4">
          <div className="flex justify-between items-center"><span className="text-[10px] font-bold uppercase">Enable Comments</span><input type="checkbox" checked={commentsEnabled} onChange={() => setCommentsEnabled(!commentsEnabled)} className="accent-accent" /></div>
          
            <div className="flex justify-between items-center"><span className="text-[10px] font-bold uppercase">Explicit Content</span><div className="flex gap-2"><button onClick={() => setIsExplicit(true)} className={`px-4 py-2 rounded-xl text-[9px] font-bold uppercase ${isExplicit ? 'bg-accent text-white' : 'bg-gray-50'}`}>Yes</button><button onClick={() => setIsExplicit(false)} className={`px-4 py-2 rounded-xl text-[9px] font-bold uppercase ${!isExplicit ? 'bg-accent text-white' : 'bg-gray-50'}`}>No</button></div></div>
        
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Button variant="outline" onClick={onBack}>Cancel</Button>
          <Button onClick={() => {
            onPost({
              tagline,
              isExplicit,
              commentsEnabled,
              coverImage,
              genres: selectedGenres,
              hashtags: hashtags.split(',').map(h => h.trim().replace(/^#/, '')).filter(h => h.length > 0)
            });
          }}>Post</Button>
        </div>
      </div>
    </div>
  );
};

const ForgotPasswordView = ({ onBack, registeredUsers, onResetPassword, showToast }: any) => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const handleSendReset = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showToast('Please enter a valid email', 'error');
      return;
    }
    try {
      await onResetPassword(email);
      setSent(true);
      showToast('Password reset email sent!', 'check_circle');
    } catch {
      showToast('Failed to send reset email', 'error');
    }
  };

  return (
    <div className="fixed inset-0 bg-white p-8 flex flex-col items-center justify-center animate-in fade-in duration-500">
      <header className="absolute top-8 left-8">
        <button onClick={onBack} className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400">
          <span className="material-icons-round">arrow_back</span>
        </button>
      </header>

      {!sent ? (
        <>
          <h1 className="text-3xl font-display mb-4">Reset Password</h1>
          <p className="text-center text-xs text-gray-400 font-bold uppercase tracking-widest mb-12 px-8">Enter your email and we'll send you a reset link.</p>
          <div className="w-full max-w-sm space-y-8 mb-8">
            <Input label="Email Address" placeholder="you@example.com" value={email} onChange={(val: string) => setEmail(val)} />
            <Button className="w-full" onClick={handleSendReset}>Send Reset Link</Button>
          </div>
        </>
      ) : (
        <>
          <span className="material-icons-round text-5xl text-green-500 mb-4">check_circle</span>
          <h1 className="text-3xl font-display mb-4">Check Your Email</h1>
          <p className="text-center text-xs text-gray-400 font-bold uppercase tracking-widest mb-12 px-8">We sent a password reset link to {email}</p>
          <Button className="w-full max-w-sm" onClick={onBack}>Back to Login</Button>
        </>
      )}
    </div>
  );
};

const SettingsView = ({ onBack, handleLogout, onNavigate, isAdmin, user, onUpdateUser, onUpdatePassword, showToast }: any) => {
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [formValue, setFormValue] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSave = () => {
    if (activeModal === 'email') {
      if (!formValue.includes('@')) {
        showToast('Please enter a valid email', 'error');
        return;
      }
      onUpdateUser({ ...user, email: formValue });
      showToast('Email updated!', 'check_circle');
    } else if (activeModal === 'displayName') {
      if (formValue.length < 3) {
        showToast('Display name must be at least 3 characters', 'error');
        return;
      }
      onUpdateUser({ ...user, displayName: formValue });
      showToast('Display name updated!', 'check_circle');
    } else if (activeModal === 'password') {
      if (formValue.length < 12) {
        showToast('Password must be at least 12 characters', 'error');
        return;
      }
      if (formValue !== confirmPassword) {
        showToast('Passwords do not match', 'error');
        return;
      }
      onUpdatePassword(formValue);
      showToast('Password updated!', 'check_circle');
    }
    setActiveModal(null);
    setFormValue('');
    setConfirmPassword('');
  };

  const accountOptions = [
    { label: 'Change Email', action: () => { setActiveModal('email'); setFormValue(user.email || ''); } },
    { label: 'Change Display Name', action: () => { setActiveModal('displayName'); setFormValue(user.displayName); } },
    { label: 'Change Password', action: () => { setActiveModal('password'); setFormValue(''); } },
    { label: 'Blocked Users', action: () => onNavigate('blocked-users') },
    { label: 'Permanently Delete Account', action: () => setShowDeleteConfirm(true), danger: true },
  ];

  return (
    <div className="fixed inset-0 bg-white overflow-y-auto no-scrollbar animate-in slide-in-from-right duration-500">
      <header className="p-6 flex items-center gap-4"><button onClick={onBack} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400"><span className="material-icons-round">arrow_back</span></button><h1 className="text-xl font-bold">Settings</h1></header>

      {/* Modal for editing */}
      {activeModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[500] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full space-y-6 animate-in zoom-in-95 duration-300">
            <h2 className="text-lg font-bold text-center">
              {activeModal === 'email' ? 'Change Email' : activeModal === 'displayName' ? 'Change Display Name' : 'Change Password'}
            </h2>
            <div className="space-y-4">
              <input
                type={activeModal === 'password' ? 'password' : activeModal === 'email' ? 'email' : 'text'}
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                placeholder={activeModal === 'email' ? 'Enter new email' : activeModal === 'displayName' ? 'Enter new display name' : 'Enter new password'}
                className="w-full p-4 rounded-2xl bg-gray-50 border border-gray-100 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-accent"
              />
              {activeModal === 'password' && (
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="w-full p-4 rounded-2xl bg-gray-50 border border-gray-100 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-accent"
                />
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setActiveModal(null); setFormValue(''); setConfirmPassword(''); }} className="flex-1 py-4 rounded-2xl bg-gray-100 text-sm font-bold transition-all active:scale-95">Cancel</button>
              <button onClick={handleSave} className="flex-1 py-4 rounded-2xl bg-accent text-white text-sm font-bold transition-all active:scale-95">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete account confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[500] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full space-y-6 animate-in zoom-in-95 duration-300">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
                <span className="material-icons-round text-red-500 text-3xl">warning</span>
              </div>
              <h2 className="text-lg font-bold">Delete Account?</h2>
              <p className="text-sm text-gray-400 leading-relaxed">
                This action cannot be undone. All your books, comments, and data will be permanently deleted.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-4 rounded-2xl bg-gray-100 text-sm font-bold transition-all active:scale-95">Cancel</button>
              <button onClick={() => { setShowDeleteConfirm(false); handleLogout(); showToast('Account deleted', 'check_circle'); }} className="flex-1 py-4 rounded-2xl bg-red-500 text-white text-sm font-bold transition-all active:scale-95">Delete</button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 space-y-10 pb-32">
        <section className="space-y-4">
          <h3 className="text-[10px] font-bold text-gray-300 uppercase tracking-widest ml-4">Account & Privacy</h3>
          <div className="bg-gray-50 rounded-[2.5rem] overflow-hidden border border-gray-100">
            {accountOptions.map((opt, i) => (
              <button
                key={opt.label}
                onClick={opt.action}
                className={`w-full p-6 text-left flex justify-between items-center group active:bg-white transition-all ${opt.danger ? 'text-red-500' : ''} border-b border-gray-100 last:border-none`}
              >
                <span className="font-bold text-sm">{opt.label}</span>
                <span className="material-icons-round text-gray-200 group-hover:text-accent transition-colors">chevron_right</span>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-[10px] font-bold text-gray-300 uppercase tracking-widest ml-4">App Configuration</h3>
          <div className="bg-gray-50 rounded-[2.5rem] overflow-hidden border border-gray-100">
            <button
              onClick={() => onNavigate('notification-settings')}
              className="w-full p-6 text-left flex justify-between items-center group active:bg-white transition-all border-b border-gray-100"
            >
              <span className="font-bold text-sm">Notification Settings</span><span className="material-icons-round text-gray-200 group-hover:text-accent transition-colors">chevron_right</span>
            </button>
            <button
              onClick={() => showToast('More languages coming soon!', 'translate')}
              className="w-full p-6 text-left flex justify-between items-center group active:bg-white transition-all"
            >
              <span className="font-bold text-sm">Language</span><span className="material-icons-round text-gray-200 group-hover:text-accent transition-colors">chevron_right</span>
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-[10px] font-bold text-gray-300 uppercase tracking-widest ml-4">Payments</h3>
          <div className="bg-gray-50 rounded-[2.5rem] overflow-hidden border border-gray-100">
            {['Add Bank Account', 'View Earnings', 'Withdraw Earnings', 'View Purchase History'].map((opt, i) => (
              <button
                key={opt}
                onClick={() => showToast('Payment features coming soon!', 'account_balance')}
                className={`w-full p-6 text-left flex justify-between items-center group active:bg-white transition-all ${i !== 3 ? 'border-b border-gray-100' : ''}`}
              >
                <span className="font-bold text-sm">{opt}</span><span className="material-icons-round text-gray-200 group-hover:text-accent transition-colors">chevron_right</span>
              </button>
            ))}
          </div>
        </section>

        {isAdmin && (
          <section className="space-y-4">
            <h3 className="text-[10px] font-bold text-gray-300 uppercase tracking-widest ml-4">Administration</h3>
            <div className="bg-gray-50 rounded-[2.5rem] overflow-hidden border border-gray-100">
              <button
                onClick={() => onNavigate('admin-dashboard')}
                className="w-full p-6 text-left flex justify-between items-center group active:bg-white transition-all"
              >
                <span className="font-bold text-sm">Admin Dashboard</span>
                <span className="material-icons-round text-gray-200 group-hover:text-accent transition-colors">chevron_right</span>
              </button>
            </div>
          </section>
        )}

        <Button variant="destructive" className="w-full" onClick={handleLogout}><span className="material-icons-round">logout</span> Log Out</Button>
      </div>
    </div>
  );
};

const AdminDashboard = ({
  reports, books, comments, registeredUsers,
  onBack, onRemoveBook, onRemoveComment, onAddStrike, onRemoveStrike, onBanUser, onDismissReport,
  getItemCost, onUpdateItemPrice
}: any) => {
  const [activeTab, setActiveTab] = useState<'reports' | 'users' | 'books' | 'pricing'>('reports');
  const [pricingFilter, setPricingFilter] = useState<'all' | 'face' | 'hair' | 'outfit'>('all');

  const tabs = [
    { id: 'reports', label: 'Reports', icon: 'flag' },
    { id: 'users', label: 'Users', icon: 'people' },
    { id: 'books', label: 'Books', icon: 'menu_book' },
    { id: 'pricing', label: 'Pricing', icon: 'sell' },
  ];

  const pendingReports = reports.filter((r: Report) => r.status === 'pending');

  return (
    <div className="fixed inset-0 bg-white overflow-y-auto no-scrollbar animate-in slide-in-from-right duration-500">
      <header className="p-6 flex items-center gap-4">
        <button onClick={onBack} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400">
          <span className="material-icons-round">arrow_back</span>
        </button>
        <h1 className="text-xl font-bold">Admin Dashboard</h1>
      </header>

      {/* Stats Overview */}
      <div className="px-6 mb-6 grid grid-cols-3 gap-3">
        <div className="bg-gray-50 rounded-2xl p-4 text-center border border-gray-100">
          <p className="text-lg font-bold">{pendingReports.length}</p>
          <p className="text-[8px] font-bold text-gray-300 uppercase tracking-widest">Pending</p>
        </div>
        <div className="bg-gray-50 rounded-2xl p-4 text-center border border-gray-100">
          <p className="text-lg font-bold">{registeredUsers.length}</p>
          <p className="text-[8px] font-bold text-gray-300 uppercase tracking-widest">Users</p>
        </div>
        <div className="bg-gray-50 rounded-2xl p-4 text-center border border-gray-100">
          <p className="text-lg font-bold">{books.length}</p>
          <p className="text-[8px] font-bold text-gray-300 uppercase tracking-widest">Books</p>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="px-6 flex gap-2 mb-6">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex-1 h-12 rounded-2xl font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
              activeTab === tab.id
                ? 'bg-accent text-white shadow-lg shadow-accent/20'
                : 'bg-gray-50 text-gray-400'
            }`}
          >
            <span className="material-icons-round text-base">{tab.icon}</span>
            {tab.label}
            {tab.id === 'reports' && pendingReports.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-white/30 text-[9px] flex items-center justify-center">{pendingReports.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="px-6 pb-32 space-y-4">

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">Pending Reports ({pendingReports.length})</h3>
            {pendingReports.length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 text-gray-300">
                <span className="material-icons-round text-4xl mb-4">check_circle</span>
                <p className="text-[10px] font-bold uppercase tracking-widest">No pending reports</p>
              </div>
            )}
            {pendingReports.length > 0 && (
              <div className="bg-gray-50 rounded-[2.5rem] overflow-hidden border border-gray-100">
                {pendingReports.map((report: Report) => {
                  let targetLabel = report.targetId;
                  if (report.type === 'Book') {
                    const book = books.find((b: Book) => b.id === report.targetId);
                    targetLabel = book ? book.title : report.targetId;
                  } else if (report.type === 'Comment') {
                    const comment = comments.find((c: Comment) => c.id === report.targetId);
                    targetLabel = comment ? `"${comment.text.substring(0, 40)}..."` : report.targetId;
                  }
                  return (
                    <div key={report.id} className="p-6 border-b border-gray-100 last:border-none space-y-3">
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-accent">{report.type}</span>
                        <p className="text-sm font-bold mt-1">{targetLabel}</p>
                        <p className="text-[10px] text-gray-400 mt-1">Reported by @{report.reportedBy}</p>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {report.type === 'Book' && (
                          <button onClick={() => onRemoveBook(report.targetId)} className="h-10 px-4 rounded-xl bg-red-500/10 text-red-500 text-[10px] font-bold uppercase tracking-widest">Remove Book</button>
                        )}
                        {report.type === 'Comment' && (
                          <button onClick={() => onRemoveComment(report.targetId)} className="h-10 px-4 rounded-xl bg-red-500/10 text-red-500 text-[10px] font-bold uppercase tracking-widest">Remove Comment</button>
                        )}
                        {report.type === 'User' && (
                          <>
                            <button onClick={() => onAddStrike(report.targetId)} className="h-10 px-4 rounded-xl bg-orange-500/10 text-orange-500 text-[10px] font-bold uppercase tracking-widest">Strike</button>
                            <button onClick={() => onBanUser(report.targetId)} className="h-10 px-4 rounded-xl bg-red-500/10 text-red-500 text-[10px] font-bold uppercase tracking-widest">Ban User</button>
                          </>
                        )}
                        <button onClick={() => onDismissReport(report.id)} className="h-10 px-4 rounded-xl bg-gray-100 text-gray-400 text-[10px] font-bold uppercase tracking-widest">Dismiss</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">Registered Users ({registeredUsers.length})</h3>
            <div className="bg-gray-50 rounded-[2.5rem] overflow-hidden border border-gray-100">
              {registeredUsers.map((u: UserRecord) => (
                <div key={u.username} className="p-6 border-b border-gray-100 last:border-none flex justify-between items-center">
                  <div>
                    <p className="text-sm font-bold">{u.displayName}</p>
                    <p className="text-[10px] text-gray-400">@{u.username}</p>
                    {u.strikes > 0 && (
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-[9px] font-bold text-orange-500 uppercase tracking-widest">{u.strikes} Strike{u.strikes > 1 ? 's' : ''}</p>
                        <button onClick={() => onRemoveStrike(u.username)} className="text-[8px] font-bold text-gray-400 underline uppercase tracking-widest hover:text-accent">Remove</button>
                      </div>
                    )}
                  </div>
                  {!ADMIN_USERNAMES.includes(u.username) && (
                    <div className="flex gap-2">
                      <button onClick={() => onAddStrike(u.username)} className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-500 flex items-center justify-center" title="Add Strike">
                        <span className="material-icons-round text-base">warning</span>
                      </button>
                      <button onClick={() => onBanUser(u.username)} className="w-10 h-10 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center" title="Ban User">
                        <span className="material-icons-round text-base">block</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Books Tab */}
        {activeTab === 'books' && (
          <>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">All Books ({books.length})</h3>
            <div className="bg-gray-50 rounded-[2.5rem] overflow-hidden border border-gray-100">
              {books.map((b: Book) => (
                <div key={b.id} className="p-6 border-b border-gray-100 last:border-none flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-14 rounded-lg flex-shrink-0 overflow-hidden relative" style={{ backgroundColor: b.coverColor }}><CoverImg book={b} /></div>
                    <div>
                      <p className="text-sm font-bold">{b.title}</p>
                      <p className="text-[10px] text-gray-400">by {b.author.displayName}</p>
                      {b.isDraft && <p className="text-[9px] font-bold text-gray-300 uppercase tracking-widest mt-1">Draft</p>}
                    </div>
                  </div>
                  <button onClick={() => onRemoveBook(b.id)} className="w-10 h-10 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center flex-shrink-0" title="Remove Book">
                    <span className="material-icons-round text-base">delete</span>
                  </button>
                </div>
              ))}
              {books.length === 0 && (
                <div className="flex flex-col items-center justify-center h-40 text-gray-300">
                  <span className="material-icons-round text-4xl mb-4">menu_book</span>
                  <p className="text-[10px] font-bold uppercase tracking-widest">No books</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Pricing Tab */}
        {activeTab === 'pricing' && (
          <>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4">Avatar Item Pricing</h3>
            <p className="text-[10px] text-gray-400 ml-4 mb-3">Set point costs for each item. 0 = free.</p>
            {/* Filter buttons */}
            <div className="flex gap-2 mb-4">
              {(['all', 'face', 'hair', 'outfit'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setPricingFilter(f)}
                  className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition ${pricingFilter === f ? 'bg-accent text-white' : 'bg-gray-100 text-gray-400'}`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="bg-gray-50 rounded-[2.5rem] overflow-hidden border border-gray-100">
              {AVATAR_ITEMS
                .filter(item => item.id !== 'none' && item.id !== 'no_face' && item.category !== 'body')
                .filter(item => pricingFilter === 'all' || item.category === pricingFilter)
                .map((item: AvatarItem) => {
                  const currentCost = getItemCost(item.id);
                  return (
                    <div key={item.id} className="p-4 px-6 border-b border-gray-100 last:border-none flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-12 h-12 rounded-xl bg-white border border-gray-200 flex-shrink-0 overflow-hidden flex items-center justify-center">
                          {item.path ? (
                            <img src={item.path} className="w-full h-full object-contain" />
                          ) : (
                            <span className="material-icons-round text-gray-300 text-lg">block</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate">{item.label}</p>
                          <p className="text-[9px] text-gray-400 uppercase tracking-widest">{item.category} · {item.gender} · {item.id}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="material-icons-round text-[14px] text-accent">stars</span>
                        <input
                          type="number"
                          min="0"
                          step="25"
                          value={currentCost}
                          onChange={e => onUpdateItemPrice(item.id, Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-20 h-10 rounded-xl border border-gray-200 text-center text-sm font-bold focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const CommentsView = ({ comments, onBack, onPost, onReport, onLikeComment, currentUsername = '', chapters = [], initialChapterIndex = 0 }: any) => {
  const [newText, setNewText] = useState('');
  const [activeChapter, setActiveChapter] = useState<number>(initialChapterIndex);

  // Filter comments for the selected chapter
  // Comments without chapterIndex (legacy) are treated as belonging to chapter 0
  const filteredComments = chapters.length > 0
    ? comments.filter((c: any) => (c.chapterIndex ?? 0) === activeChapter)
    : comments;

  const handlePost = () => {
    if (newText.trim()) {
        onPost(newText, chapters.length > 0 ? activeChapter : undefined);
        setNewText('');
    }
  };

  return (
    <div className="fixed inset-0 bg-white overflow-y-auto p-6 animate-in slide-in-from-bottom duration-500 z-[400]">
      <header className="flex justify-between items-center mb-1 sticky top-0 bg-white py-2 z-10">
        <div>
          <h1 className="text-xl font-bold">Comments</h1>
          {chapters.length > 0 && <p className="text-xs text-teal-600 font-semibold uppercase tracking-wide">For this chapter</p>}
        </div>
        <button onClick={onBack} className="w-10 h-10 text-gray-300 transition-transform active:scale-90"><span className="material-icons-round">close</span></button>
      </header>

      <div className="space-y-6 pb-32">
        {filteredComments.map((c: any) => {
          const hasLiked = (c.likedBy || []).includes(currentUsername);
          return (
          <div key={c.id} className="p-5 bg-gray-50 rounded-3xl space-y-3 border border-gray-100 group relative">
            <div className="flex justify-between">
              <span className="text-xs font-bold text-accent">{c.author}</span>
              <span className="text-[9px] font-bold text-gray-300 uppercase">{c.timestamp}</span>
            </div>
            <p className="text-sm leading-relaxed">{c.text}</p>
            <div className="flex gap-4 pt-2">
              <button onClick={() => onLikeComment(c.id)} className={`flex items-center gap-1.5 transition-all active:scale-90 ${hasLiked ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={hasLiked}>
                  <span className={`material-icons-round text-sm ${hasLiked ? 'text-accent' : 'text-gray-300'}`}>thumb_up</span>
                  <span className={`text-[10px] font-bold ${hasLiked ? 'text-accent' : 'text-gray-400'}`}>{c.likes}</span>
              </button>
              <button onClick={() => onReport(c.id)} className="flex items-center gap-1.5 transition-all active:scale-90 group">
                  <span className="material-icons-round text-sm text-gray-200 group-active:text-red-500">report</span>
                  <span className="text-[10px] font-bold text-gray-400">Report</span>
              </button>
            </div>
          </div>
        );})}
        {filteredComments.length === 0 && (
            <div className="text-center py-20 text-gray-200 font-bold uppercase tracking-widest text-[10px]">
              {chapters.length > 0 ? `No comments on this chapter yet` : 'Be the first to comment'}
            </div>
        )}
      </div>
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-white border-t border-gray-50 flex gap-4">
        <input
            placeholder={chapters.length > 0 ? `Comment on ${chapters[activeChapter]?.title || 'this chapter'}...` : "Add a comment..."}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePost()}
            className="flex-1 bg-gray-50 rounded-2xl px-5 py-4 text-sm outline-none shadow-inner"
        />
        <button onClick={handlePost} className="w-14 h-14 bg-accent text-white rounded-2xl flex items-center justify-center shadow-lg transition-transform active:scale-90"><span className="material-icons-round">send</span></button>
      </div>
    </div>
  );
};

// --- Chat Components ---

const ChatListView = ({ currentUsername, relationships, registeredUsers, mutualsFallback, chatMessages, blockedUsers, onSelectChat, onBack, getAvatarItemPath, avatarConfigs = {} }: any) => {
  // Get actual mutual usernames
  const myAdmiring = relationships.filter((r: Relationship) => r.admirer === currentUsername).map((r: Relationship) => r.target);
  const mutualUsernames = myAdmiring.filter((t: string) => relationships.some((r: Relationship) => r.admirer === t && r.target === currentUsername));

  // Build mutual user objects
  const mutuals = mutualUsernames.map((username: string) => {
    return registeredUsers.find((u: any) => u.username === username) || mutualsFallback.find((u: any) => u.username === username);
  }).filter(Boolean).filter((u: any) => !blockedUsers.has(u.username));

  // Also include non-mutual users who have existing messages (read-only conversations)
  const usersWithMessages = Array.from(new Set(
    chatMessages
      .filter((m: ChatMessage) => m.from === currentUsername || m.to === currentUsername)
      .map((m: ChatMessage) => m.from === currentUsername ? m.to : m.from)
  )).filter((username: string) => !mutualUsernames.includes(username) && !blockedUsers.has(username));

  const nonMutualChatUsers = usersWithMessages.map((username: string) => {
    return registeredUsers.find((u: any) => u.username === username) || mutualsFallback.find((u: any) => u.username === username);
  }).filter(Boolean);

  // Combine mutuals and non-mutual users with existing messages
  const allChatUsers = [...mutuals, ...nonMutualChatUsers];

  // Fall back to demo mutuals if none
  const displayUsers = allChatUsers.length > 0 ? allChatUsers : mutualsFallback.filter((u: any) => !blockedUsers.has(u.username));

  // Get conversations with last message
  const conversations = displayUsers.map((chatUser: any) => {
    const msgs = chatMessages.filter((m: ChatMessage) =>
      (m.from === currentUsername && m.to === chatUser.username) ||
      (m.from === chatUser.username && m.to === currentUsername)
    );
    const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    const unread = msgs.filter((m: ChatMessage) => m.to === currentUsername && !m.read).length;
    const isStillMutual = mutualUsernames.includes(chatUser.username);
    return { user: chatUser, lastMessage: lastMsg, unreadCount: unread, messageCount: msgs.length, isMutual: isStillMutual };
  }).sort((a: any, b: any) => {
    // Sort by most recent message, then by unread
    if (a.lastMessage && b.lastMessage) return new Date(b.lastMessage.timestamp).getTime() - new Date(a.lastMessage.timestamp).getTime();
    if (a.lastMessage) return -1;
    if (b.lastMessage) return 1;
    return 0;
  });

  return (
    <div className="fixed inset-0 bg-white overflow-y-auto no-scrollbar pb-32 animate-in slide-in-from-right duration-500 z-[400]">
      <header className="p-6 flex items-center gap-4 sticky top-0 bg-white/80 backdrop-blur-xl z-50">
        <button onClick={onBack} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400">
          <span className="material-icons-round">arrow_back</span>
        </button>
        <h1 className="text-xl font-bold flex-1">Messages</h1>
      </header>

      {conversations.length === 0 ? (
        <div className="p-12 text-center">
          <span className="material-icons-round text-5xl text-gray-200 mb-4">chat</span>
          <p className="text-sm font-bold text-gray-300 uppercase tracking-widest">No mutuals yet</p>
          <p className="text-xs text-gray-400 mt-2">Admire someone and have them admire you back to start chatting!</p>
        </div>
      ) : (
        <div className="px-4">
          {conversations.map((conv: any) => (
            <button
              key={conv.user.username}
              onClick={() => onSelectChat(conv.user.username)}
              className="w-full p-4 flex items-center gap-4 rounded-2xl transition-all active:scale-[0.98] hover:bg-gray-50 group"
            >
              <div className="relative flex-shrink-0">
                <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-xl font-bold overflow-hidden">
                  {avatarConfigs[conv.user.username] ? (
                    <img src={getAvatarItemPath('body', avatarConfigs[conv.user.username].bodyId)} className="w-full h-full object-cover" />
                  ) : (
                    <span className="material-icons-round text-2xl">person</span>
                  )}
                </div>
                <div className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white ${conv.user.isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold truncate">{conv.user.displayName}</span>
                  {conv.lastMessage && (
                    <span className="text-[9px] text-gray-300 font-bold flex-shrink-0">
                      {(() => {
                        const diff = Date.now() - new Date(conv.lastMessage.timestamp).getTime();
                        const mins = Math.floor(diff / 60000);
                        if (mins < 1) return 'now';
                        if (mins < 60) return `${mins}m`;
                        const hrs = Math.floor(mins / 60);
                        if (hrs < 24) return `${hrs}h`;
                        return `${Math.floor(hrs / 24)}d`;
                      })()}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 truncate mt-0.5">
                  {conv.lastMessage
                    ? `${conv.lastMessage.from === currentUsername ? 'You: ' : ''}${conv.lastMessage.text}`
                    : 'Start a conversation'}
                </p>
              </div>
              {conv.unreadCount > 0 && (
                <span className="w-6 h-6 bg-accent text-white text-[10px] font-bold rounded-full flex items-center justify-center flex-shrink-0">
                  {conv.unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const ChatConversationView = ({ currentUsername, currentDisplayName, targetUsername, targetUser, messages, onSend, onBack, getAvatarItemPath, avatarConfig, isMutual }: any) => {
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (newMessage.trim()) {
      onSend(newMessage);
      setNewMessage('');
    }
  };

  // Sort messages by timestamp, then group by date
  const sortedMessages = [...messages].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const groupedMessages = sortedMessages.reduce((groups: any, msg: ChatMessage) => {
    const date = new Date(msg.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (!groups[date]) groups[date] = [];
    groups[date].push(msg);
    return groups;
  }, {});

  return (
    <div className="fixed inset-0 bg-white flex flex-col animate-in slide-in-from-right duration-500 z-[400]">
      {/* Header */}
      <header className="p-4 flex items-center gap-3 bg-white border-b border-gray-100 z-10">
        <button onClick={onBack} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400">
          <span className="material-icons-round">arrow_back</span>
        </button>
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden">
            {avatarConfig ? (
              <img src={getAvatarItemPath('body', avatarConfig.bodyId)} className="w-full h-full object-cover" />
            ) : (
              <span className="material-icons-round text-gray-400">person</span>
            )}
          </div>
          {targetUser?.isOnline && (
            <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-white" />
          )}
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold">{targetUser?.displayName || targetUsername}</p>
          <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">
            {targetUser?.isOnline ? 'Online' : 'Offline'}
          </p>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-1">
        {messages.length === 0 && (
          <div className="text-center py-20">
            <span className="material-icons-round text-4xl text-gray-200 mb-2">chat_bubble_outline</span>
            <p className="text-xs text-gray-300 font-bold uppercase tracking-widest">No messages yet</p>
            <p className="text-[10px] text-gray-400 mt-1">Say hello!</p>
          </div>
        )}
        {Object.entries(groupedMessages).map(([date, msgs]: [string, any]) => (
          <div key={date}>
            <div className="text-center my-4">
              <span className="text-[9px] font-bold text-gray-300 uppercase tracking-widest bg-gray-50 px-3 py-1 rounded-full">{date}</span>
            </div>
            {msgs.map((msg: ChatMessage) => {
              const isMine = msg.from === currentUsername;
              return (
                <div key={msg.id} className={`flex mb-2 ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] px-4 py-3 rounded-2xl ${
                    isMine
                      ? 'bg-accent text-white rounded-br-md'
                      : 'bg-gray-100 text-black rounded-bl-md'
                  }`}>
                    <p className="text-sm leading-relaxed">{msg.text}</p>
                    <p className={`text-[8px] mt-1 ${isMine ? 'text-white/60' : 'text-gray-400'}`}>
                      {new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input — only shown if still mutuals */}
      {isMutual !== false ? (
      <div className="p-4 bg-white border-t border-gray-100 flex gap-3">
        <input
          placeholder="Type a message..."
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          className="flex-1 bg-gray-50 rounded-2xl px-5 py-4 text-sm outline-none shadow-inner"
        />
        <button
          onClick={handleSend}
          disabled={!newMessage.trim()}
          className="w-14 h-14 bg-accent text-white rounded-2xl flex items-center justify-center shadow-lg transition-transform active:scale-90 disabled:opacity-40"
        >
          <span className="material-icons-round">send</span>
        </button>
      </div>
      ) : (
      <div className="p-4 bg-gray-50 border-t border-gray-100 text-center">
        <p className="text-xs text-gray-400 font-medium">You are no longer mutuals. Messages are read-only.</p>
      </div>
      )}
    </div>
  );
};

const WriteView = ({ books, user, onPublish, onSaveDraft, onMonetize, onBack, onNotify }: any) => {
  const [newTitle, setNewTitle] = useState('');
  const [selectedBookId, setSelectedBookId] = useState<string>('new');
  const [selectedChapterIndex, setSelectedChapterIndex] = useState<string>('new');
  const [draftSaved, setDraftSaved] = useState(false);
  const [wordCount, setWordCount] = useState(0); // Reactive word count state
  const editorRef = useRef<HTMLDivElement>(null);
  
  const myWorks = useMemo(() => books.filter((b: Book) => b.author.username === user.username), [books, user]);
  const selectedBook = useMemo(() => myWorks.find((w: Book) => w.id === selectedBookId), [myWorks, selectedBookId]);

  const calculateWordCount = useCallback((text: string) => {
    const cleanText = text.replace(/<\/?[^>]+(>|$)/g, "").trim();
    return cleanText === '' ? 0 : cleanText.split(/\s+/).length;
  }, []);

  const updateWordCount = useCallback(() => {
    if (editorRef.current) {
      const text = editorRef.current.innerText || "";
      const count = calculateWordCount(text);
      if (count > MAX_WORD_COUNT) {
        const words = text.trim().split(/\s+/);
        const truncated = words.slice(0, MAX_WORD_COUNT).join(' ');
        editorRef.current.innerText = truncated;
        setWordCount(MAX_WORD_COUNT);
        return;
      }
      if (count >= MAX_WORD_COUNT - 100 && wordCount < MAX_WORD_COUNT - 100) {
        onNotify?.('Approaching limit', 'You are in your last 100 words!');
      }
      setWordCount(count);
    }
  }, [calculateWordCount, wordCount, onNotify]);

  useEffect(() => {
    document.execCommand('defaultParagraphSeparator', false, 'p');
  }, []);

  useEffect(() => {
    if (selectedBookId !== 'new' && selectedBook) {
      setNewTitle(selectedBook.title);
      setSelectedChapterIndex('new');
    } else {
      setNewTitle('');
      setSelectedChapterIndex('new');
    }
  }, [selectedBookId, selectedBook]);

  useEffect(() => {
    let content = '';
    if (selectedBook && selectedChapterIndex !== 'new') {
      const idx = parseInt(selectedChapterIndex);
      if (selectedBook.chapters && selectedBook.chapters[idx]) {
        content = selectedBook.chapters[idx].content;
      }
    }
    
    if (editorRef.current) {
      if (editorRef.current.innerHTML !== content) {
        editorRef.current.innerHTML = content;
        updateWordCount();
      }
    }
  }, [selectedChapterIndex, selectedBookId, selectedBook, updateWordCount]);

  const execAction = (cmd: string, val: string | null = null) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(cmd, false, val || undefined);
    updateWordCount(); 
  };

  const canPublish = wordCount >= MIN_WORD_COUNT && (selectedBookId !== 'new' || newTitle.trim().length > 0);


  return (
    <div className="fixed inset-0 bg-white flex flex-col pb-20 animate-in fade-in duration-500 overflow-hidden">
      <header className="px-6 py-6 border-b border-gray-50 flex justify-between items-center bg-white z-50">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 transition-colors hover:text-accent">
            <span className="material-icons-round">arrow_back</span>
          </button>
          <div>
            <h1 className="text-xl font-bold">Studio</h1>
          </div>
        </div>
        <Button variant="secondary" className="h-10 px-4" onClick={onMonetize}><span className="material-icons-round text-sm">paid</span> Monetize</Button>
      </header>

      <div className="flex-1 p-6 space-y-6 overflow-y-auto no-scrollbar">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-2">Your Works</label>
            <select className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 text-sm font-medium outline-none appearance-none cursor-pointer shadow-sm" value={selectedBookId} onChange={(e) => setSelectedBookId(e.target.value)}>
              <option value="new">Start a New Work</option>
              {myWorks.map((w: Book) => <option key={w.id} value={w.id}>{w.title}</option>)}
            </select>
          </div>

          {selectedBookId === 'new' && (
            <div className="space-y-1.5 animate-in slide-in-from-top duration-300">
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-2">Book Title</label>
              <input placeholder="Enter new book title..." value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-accent/10" />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-2">Chapter Selection</label>
            <select className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 text-sm font-medium outline-none appearance-none cursor-pointer shadow-sm" value={selectedChapterIndex} onChange={(e) => setSelectedChapterIndex(e.target.value)}>
              <option value="new">+ New Chapter</option>
              {selectedBook?.chapters?.map((ch: any, idx: number) => (
                <option key={idx} value={idx}>{ch.title}</option>
              ))}
            </select>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-1 p-1 bg-gray-50 rounded-2xl border border-gray-100 sticky top-0 z-10 shadow-sm">
          <button onMouseDown={(e) => { e.preventDefault(); execAction('bold'); }} className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 hover:text-accent hover:bg-white transition-all active:scale-90" title="Bold"><span className="material-icons-round text-sm">format_bold</span></button>
          <button onMouseDown={(e) => { e.preventDefault(); execAction('italic'); }} className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 hover:text-accent hover:bg-white transition-all active:scale-90" title="Italic"><span className="material-icons-round text-sm">format_italic</span></button>
          <button onMouseDown={(e) => { e.preventDefault(); execAction('underline'); }} className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 hover:text-accent hover:bg-white transition-all active:scale-90" title="Underline"><span className="material-icons-round text-sm">format_underlined</span></button>
          <div className="w-px h-6 bg-gray-200 mx-1 self-center" />
          <button onMouseDown={(e) => { e.preventDefault(); execAction('justifyLeft'); }} className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 hover:text-accent hover:bg-white transition-all active:scale-90" title="Align Left"><span className="material-icons-round text-sm">format_align_left</span></button>
          <button onMouseDown={(e) => { e.preventDefault(); execAction('justifyCenter'); }} className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 hover:text-accent hover:bg-white transition-all active:scale-90" title="Align Center"><span className="material-icons-round text-sm">format_align_center</span></button>
          <button onMouseDown={(e) => { e.preventDefault(); execAction('justifyRight'); }} className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 hover:text-accent hover:bg-white transition-all active:scale-90" title="Align Right"><span className="material-icons-round text-sm">format_align_right</span></button>
          <div className="w-px h-6 bg-gray-200 mx-1 self-center" />
          <button onMouseDown={(e) => { e.preventDefault(); execAction('insertUnorderedList'); }} className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 hover:text-accent hover:bg-white transition-all active:scale-90" title="Bullet List"><span className="material-icons-round text-sm">format_list_bulleted</span></button>
          <button onMouseDown={(e) => { e.preventDefault(); execAction('insertOrderedList'); }} className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 hover:text-accent hover:bg-white transition-all active:scale-90" title="Numbered List"><span className="material-icons-round text-sm">format_list_numbered</span></button>
        </div>

        <div className="relative min-h-[400px]">
          {selectedBook && selectedBook.isCompleted ? (
            <div className="w-full min-h-[400px] flex flex-col items-center justify-center text-center p-8 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
              <span className="material-icons-round text-4xl text-gray-300 mb-3">lock</span>
              <p className="text-sm font-bold text-gray-400">This book has been completed</p>
              <p className="text-xs text-gray-300 mt-1">Completed works cannot be edited</p>
            </div>
          ) : (
            <div ref={editorRef} contentEditable spellCheck="true" className="w-full min-h-[400px] bg-transparent border-none outline-none text-base leading-relaxed placeholder:text-gray-200 resize-none no-scrollbar focus:ring-0 rich-editor" style={{ WebkitUserSelect: 'text', userSelect: 'text' }} onInput={updateWordCount} />
          )}
        </div>
      </div>

      <div className="p-6 bg-white border-t border-gray-50">
        <div className="flex justify-between items-center mb-6">
          <div className="flex flex-col">
            <span className={`text-[10px] font-bold uppercase tracking-widest ${wordCount < MIN_WORD_COUNT ? 'text-red-400' : (wordCount >= MAX_WORD_COUNT - 100 ? 'text-yellow-500' : 'text-green-500')}`}>
              {wordCount} / {MAX_WORD_COUNT} Words
            </span>
            <span className="text-[7px] text-gray-300 uppercase font-bold">
              {wordCount < MIN_WORD_COUNT ? `Min ${MIN_WORD_COUNT} words to publish` : (wordCount >= MAX_WORD_COUNT - 100 ? 'Approaching max word count limit!' : 'Word count limit: 11,000')}
            </span>
          </div>
          <span className="text-[8px] font-bold text-gray-300 uppercase tracking-widest">Changes saved locally</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Button variant="outline" disabled={selectedBookId === 'new' && !newTitle.trim()} onClick={() => {
              const currentContent = editorRef.current?.innerHTML || "";
              const savedId = onSaveDraft(selectedBookId === 'new' ? null : selectedBookId, newTitle, currentContent, selectedChapterIndex === 'new' ? null : parseInt(selectedChapterIndex));
              if (savedId && selectedBookId === 'new') setSelectedBookId(savedId);
              setDraftSaved(true);
              setTimeout(() => setDraftSaved(false), 2000);
            }}>{draftSaved ? '✓ Saved!' : 'Save Draft'}</Button>
          <Button disabled={!canPublish} onClick={() => {
              const currentContent = editorRef.current?.innerHTML || "";
              onPublish(selectedBookId === 'new' ? null : selectedBookId, newTitle, currentContent, selectedChapterIndex === 'new' ? null : parseInt(selectedChapterIndex));
            }}>Publish</Button>
        </div>
      </div>
    </div>
  );
};

const CustomizationView = ({ user, setUser, onBack, avatarConfig, setAvatarConfig, unlockedAvatarItems, setUnlockedAvatarItems, isAdmin, getItemCost }: any) => {
  const [activeCategory, setActiveCategory] = useState<AvatarCategory>('body');
  const [pendingUnlock, setPendingUnlock] = useState<{ id: string; cost: number } | null>(null);

  const [localConfig, setLocalConfig] = useState<AvatarConfig | null>(avatarConfig);
  const [showGenderPick, setShowGenderPick] = useState(!avatarConfig);
  const [adjustMode, setAdjustMode] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<'hair' | 'face'>('hair');
  const [adj, setAdj] = useState<{ width: number; left: number; top: number }>({ width: 38, left: 31, top: -5 });
  const [zoomLevel, setZoomLevel] = useState(1);

  // Sync sliders when hair/face changes
  React.useEffect(() => {
    if (!localConfig) return;
    if (adjustTarget === 'hair' && localConfig.hairId !== 'none') {
      const pos = getHairPosition(localConfig.hairId);
      setAdj({ width: parseFloat(pos.width), left: parseFloat(pos.left), top: parseFloat(pos.top) });
    } else if (adjustTarget === 'face') {
      const pos = getFacePosition(localConfig.faceId);
      setAdj({ width: parseFloat(pos.width), left: parseFloat(pos.left), top: parseFloat(pos.top) });
    }
  }, [localConfig?.hairId, localConfig?.faceId, adjustTarget]);

  // Auto-switch adjust target when category changes
  React.useEffect(() => {
    if (activeCategory === 'hair') setAdjustTarget('hair');
    else if (activeCategory === 'face') setAdjustTarget('face');
    else setAdjustMode(false);
  }, [activeCategory]);

  const handleApplyPosition = () => {
    if (!localConfig) return;
    const pos = { width: `${adj.width}%`, left: `${adj.left}%`, top: `${adj.top}%` };
    if (adjustTarget === 'hair' && localConfig.hairId !== 'none') {
      HAIR_POSITIONS[localConfig.hairId] = pos;
      localStorage.setItem('mainwrld_hair_positions', JSON.stringify(HAIR_POSITIONS));
    } else if (adjustTarget === 'face') {
      FACE_POSITIONS[localConfig.faceId] = pos;
      localStorage.setItem('mainwrld_face_positions', JSON.stringify(FACE_POSITIONS));
    }
    setAdjustMode(false);
  };

  const handleExportPositions = () => {
    const data = JSON.stringify({ hair: HAIR_POSITIONS, face: FACE_POSITIONS }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mainwrld-positions.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportPositions = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          if (data.hair) { Object.assign(HAIR_POSITIONS, data.hair); localStorage.setItem('mainwrld_hair_positions', JSON.stringify(HAIR_POSITIONS)); }
          if (data.face) { Object.assign(FACE_POSITIONS, data.face); localStorage.setItem('mainwrld_face_positions', JSON.stringify(FACE_POSITIONS)); }
          // Positions imported successfully
        } catch { /* Invalid format */ }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const categories: { key: AvatarCategory; label: string; icon: string }[] = [
    { key: 'body', label: 'Skin Tone', icon: 'accessibility_new' },
    { key: 'face', label: 'Face', icon: 'face' },
    { key: 'hair', label: 'Hair', icon: 'content_cut' },
    { key: 'outfit', label: 'Outfits', icon: 'checkroom' },
  ];

  const initDefaults = (gender: AvatarGender): AvatarConfig => ({
    gender,
    bodyId: gender === 'female' ? 'A4' : 'B4',
    faceId: gender === 'female' ? 'W_Eye_1' : 'M_Eye_1',
    hairId: gender === 'female' ? 'W_Hair_2' : 'M_Hair_1',
    outfitId: gender === 'female' ? 'D4' : 'E1',
  });

  const handleGenderSelect = (gender: AvatarGender) => {
    const defaults = initDefaults(gender);
    setLocalConfig(defaults);
    setShowGenderPick(false);
  };

  const handleSelectItem = (item: AvatarItem) => {
    if (!localConfig) return;
    const cost = getItemCost(item.id);
    const isUnlocked = cost === 0 || unlockedAvatarItems.has(item.id);
    if (!isUnlocked) {
      if (user.points >= cost) setPendingUnlock({ id: item.id, cost });
      return;
    }
    const key = item.category === 'body' ? 'bodyId' : item.category === 'face' ? 'faceId' : item.category === 'hair' ? 'hairId' : 'outfitId';
    setLocalConfig({ ...localConfig, [key]: item.id });
  };

  const handleUnlockConfirm = () => {
    if (!pendingUnlock || !localConfig) return;
    const { id, cost } = pendingUnlock;
    setUser({ ...user, points: user.points - cost });
    setUnlockedAvatarItems((prev: Set<string>) => new Set([...prev, id]));
    const item = AVATAR_ITEMS.find(i => i.id === id);
    if (item) {
      const key = item.category === 'body' ? 'bodyId' : item.category === 'face' ? 'faceId' : item.category === 'hair' ? 'hairId' : 'outfitId';
      setLocalConfig({ ...localConfig, [key]: id });
    }
    setPendingUnlock(null);
  };

  const handleSave = () => {
    if (localConfig) setAvatarConfig(localConfig);
    onBack();
  };

  const filteredItems = AVATAR_ITEMS.filter(item => {
    if (item.category !== activeCategory) return false;
    if (!localConfig) return false;
    if (item.gender === 'any') return true;
    return item.gender === localConfig.gender;
  });

  const getSelectedId = (): string => {
    if (!localConfig) return '';
    if (activeCategory === 'body') return localConfig.bodyId;
    if (activeCategory === 'face') return localConfig.faceId;
    if (activeCategory === 'hair') return localConfig.hairId;
    return localConfig.outfitId;
  };

  // Gender selection screen
  if (showGenderPick) {
    return (
      <div className="fixed inset-0 bg-white flex flex-col animate-in slide-in-from-right duration-500 z-[300]">
        <header className="p-6 border-b flex justify-between items-center bg-white/80 backdrop-blur-md">
          <button onClick={onBack} className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition">
            <span className="material-icons-round">arrow_back</span>
          </button>
          <h1 className="text-lg font-bold">Choose Your Style</h1>
          <div className="w-10" />
        </header>
        <div className="flex-1 flex items-center justify-center gap-8 p-8">
          <button onClick={() => handleGenderSelect('female')} className="flex flex-col items-center gap-4 p-6 rounded-3xl border-2 border-gray-200 hover:border-accent hover:bg-accent/5 transition-all active:scale-95 w-56">
            <div className="w-40 h-56 rounded-2xl overflow-hidden bg-gray-50">
              <img src={`${BASE}assets/avatar/body/female/A4.png`} alt="Female" className="w-full h-full object-contain" />
            </div>
            <span className="text-sm font-bold uppercase tracking-widest"></span>
          </button>
          <button onClick={() => handleGenderSelect('male')} className="flex flex-col items-center gap-4 p-6 rounded-3xl border-2 border-gray-200 hover:border-accent hover:bg-accent/5 transition-all active:scale-95 w-56">
            <div className="w-40 h-56 rounded-2xl overflow-hidden bg-gray-50">
              <img src={`${BASE}assets/avatar/body/male/B4.png`} alt="Male" className="w-full h-full object-contain" />
            </div>
            <span className="text-sm font-bold uppercase tracking-widest"></span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-white flex flex-col animate-in slide-in-from-right duration-500 z-[300]">

      {/* HEADER */}
      <header className="p-4 border-b flex justify-between items-center bg-white/80 backdrop-blur-md">
        <button onClick={onBack} className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition">
          <span className="material-icons-round">arrow_back</span>
        </button>
        <div className="text-center">
          <h1 className="text-lg font-bold">Customize</h1>
          <p className="text-[10px] font-bold text-accent uppercase tracking-widest">{user.points} Points</p>
        </div>
        <button onClick={handleSave} className="text-sm font-semibold text-accent hover:opacity-70 transition">Save</button>
      </header>

      {/* 2D AVATAR PREVIEW */}
      <div className="flex-1 bg-gradient-to-b from-gray-50 to-gray-100 flex items-center justify-center p-4 min-h-0 relative overflow-hidden">
        {localConfig && (
          <div className="relative w-52 h-72 md:w-64 md:h-96 transition-transform duration-300 ease-out" style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top center' }}>
            <img src={getAvatarItemPath('body', localConfig.bodyId)} alt="Body" className="absolute inset-0 w-full h-full object-contain" style={{ zIndex: 1 }} />
            {localConfig.faceId !== 'no_face' && <img src={getAvatarItemPath('face', localConfig.faceId)} alt="Face" className="absolute" style={{ zIndex: 2, ...(adjustMode && adjustTarget === 'face' ? { width: `${adj.width}%`, left: `${adj.left}%`, top: `${adj.top}%` } : getFacePosition(localConfig.faceId)) }} />}
            <img src={getAvatarItemPath('outfit', localConfig.outfitId)} alt="Outfit" className="absolute inset-0 w-full h-full object-contain" style={{ zIndex: 3 }} />
            {localConfig.hairId !== 'none' && <img src={getAvatarItemPath('hair', localConfig.hairId)} alt="Hair" className="absolute" style={{ zIndex: 4, ...(adjustMode && adjustTarget === 'hair' ? { width: `${adj.width}%`, left: `${adj.left}%`, top: `${adj.top}%` } : getHairPosition(localConfig.hairId)) }} />}
          </div>
        )}

        {/* ADJUST MODE CONTROLS - bottom overlay panel (admin only) */}
        {isAdmin && adjustMode && localConfig && (adjustTarget === 'face' || localConfig.hairId !== 'none') && (
          <div className="absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur rounded-t-2xl shadow-lg p-4 z-50 text-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-gray-700 text-xs">{adjustTarget === 'hair' ? localConfig.hairId : localConfig.faceId}</span>
              <span className="text-[10px] font-bold text-accent uppercase">{adjustTarget}</span>
            </div>
            <div className="space-y-2">
              <div>
                <div className="flex justify-between mb-0.5"><span className="text-gray-500">Size</span><span className="font-mono text-gray-600">{adj.width}%</span></div>
                <input type="range" min="10" max="60" step="0.5" value={adj.width} onChange={e => setAdj(p => ({ ...p, width: +e.target.value }))} className="w-full accent-[#eb6871]" />
              </div>
              <div>
                <div className="flex justify-between mb-0.5"><span className="text-gray-500">Left</span><span className="font-mono text-gray-600">{adj.left}%</span></div>
                <input type="range" min="10" max="55" step="0.5" value={adj.left} onChange={e => setAdj(p => ({ ...p, left: +e.target.value }))} className="w-full accent-[#eb6871]" />
              </div>
              <div>
                <div className="flex justify-between mb-0.5"><span className="text-gray-500">Top</span><span className="font-mono text-gray-600">{adj.top}%</span></div>
                <input type="range" min="-15" max="15" step="0.5" value={adj.top} onChange={e => setAdj(p => ({ ...p, top: +e.target.value }))} className="w-full accent-[#eb6871]" />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={handleApplyPosition} className="flex-1 py-2 bg-accent text-white rounded-full font-bold text-xs">Apply & Save</button>
              <button onClick={() => setAdjustMode(false)} className="flex-1 py-2 bg-gray-100 text-gray-500 rounded-full font-bold text-xs">Cancel</button>
            </div>
          </div>
        )}

        {/* Bottom buttons */}
        {!adjustMode && <div className="absolute bottom-3 right-3 flex gap-2">
          {isAdmin && (activeCategory === 'hair' || activeCategory === 'face') && localConfig && (activeCategory === 'face' || localConfig.hairId !== 'none') && (
            <button
              onClick={() => { setAdjustTarget(activeCategory as 'hair' | 'face'); setAdjustMode(!adjustMode); }}
              className={`px-3 py-1.5 rounded-full backdrop-blur border text-[10px] font-bold uppercase tracking-widest transition ${adjustMode ? 'bg-accent text-white border-accent' : 'bg-white/80 text-gray-500 hover:text-accent hover:border-accent'}`}
            >
              <span className="material-icons-round text-sm mr-1 align-middle">tune</span>
              Adjust
            </button>
          )}
          <button
            onClick={() => setShowGenderPick(true)}
            className="px-3 py-1.5 rounded-full bg-white/80 backdrop-blur border text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-accent hover:border-accent transition"
          >
            <span className="material-icons-round text-sm mr-1 align-middle">swap_horiz</span>
            Switch
          </button>
        </div>}
        {/* Zoom controls (admin only) */}
        {isAdmin && (
          <div className="absolute top-3 right-3 flex gap-1 z-50">
            <button onClick={() => setZoomLevel(z => Math.min(z + 0.5, 3))} className="w-8 h-8 rounded-full bg-white/80 backdrop-blur border flex items-center justify-center text-gray-500 hover:text-accent hover:border-accent transition text-sm font-bold">+</button>
            <button onClick={() => setZoomLevel(z => Math.max(z - 0.5, 1))} className="w-8 h-8 rounded-full bg-white/80 backdrop-blur border flex items-center justify-center text-gray-500 hover:text-accent hover:border-accent transition text-sm font-bold">−</button>
            {zoomLevel > 1 && <button onClick={() => setZoomLevel(1)} className="px-2 h-8 rounded-full bg-white/80 backdrop-blur border flex items-center justify-center text-gray-500 hover:text-accent hover:border-accent transition text-[10px] font-bold uppercase">Reset</button>}
          </div>
        )}
        {/* Export / Import buttons (admin only) */}
        {isAdmin && !adjustMode && (
          <div className="absolute bottom-3 left-3 flex gap-2">
            <button onClick={handleExportPositions} className="px-3 py-1.5 rounded-full bg-white/80 backdrop-blur border text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-accent hover:border-accent transition">
              <span className="material-icons-round text-sm mr-1 align-middle">download</span>
              Export
            </button>
            <button onClick={handleImportPositions} className="px-3 py-1.5 rounded-full bg-white/80 backdrop-blur border text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-accent hover:border-accent transition">
              <span className="material-icons-round text-sm mr-1 align-middle">upload</span>
              Import
            </button>
          </div>
        )}
      </div>

      {/* BOTTOM PANEL */}
      <div className="bg-white rounded-t-[2rem] shadow-2xl p-5 border-t" style={{ height: '42%' }}>

        {/* CATEGORY TABS */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3">
          {categories.map(cat => (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap
                ${activeCategory === cat.key ? 'bg-accent text-white shadow-md' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}
              `}
            >
              <span className="material-icons-round text-sm">{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>

        {/* ITEMS GRID */}
        <div className="grid grid-cols-4 gap-3 overflow-y-auto no-scrollbar" style={{ maxHeight: 'calc(100% - 50px)' }}>
          {filteredItems.map(item => {
            const cost = getItemCost(item.id);
            const isUnlocked = cost === 0 || unlockedAvatarItems.has(item.id);
            const isSelected = getSelectedId() === item.id;

            return (
              <button
                key={item.id}
                onClick={() => handleSelectItem(item)}
                disabled={!isUnlocked && user.points < cost}
                className={`relative aspect-square rounded-2xl border overflow-hidden transition-all
                  ${isSelected ? 'border-2 border-accent bg-accent/10 shadow-md' : 'bg-gray-50 border-gray-200'}
                  ${!isUnlocked ? 'border-dashed border-gray-300' : ''}
                  disabled:opacity-40 disabled:cursor-not-allowed active:scale-95
                `}
              >
                {item.id === 'none' || item.id === 'no_face' ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{item.id === 'none' ? 'No Hair' : 'No Face'}</span>
                  </div>
                ) : (
                  <img
                    src={item.path}
                    alt={item.label}
                    className={`w-full h-full ${activeCategory === 'body' ? 'object-cover object-top' : 'object-contain'} ${!isUnlocked ? 'opacity-50' : ''}`}
                  />
                )}
                {!isUnlocked && (
                  <div className="absolute top-1 right-1 text-[8px] font-bold bg-accent/10 text-accent px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                    <span className="material-icons-round text-[9px]">stars</span>
                    {cost}
                  </div>
                )}
                {isSelected && (
                  <div className="absolute bottom-0 inset-x-0 bg-accent/90 text-white text-[8px] font-bold text-center py-0.5">
                    Equipped
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* UNLOCK CONFIRM MODAL */}
      {pendingUnlock && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-[400]">
          <div className="bg-white rounded-2xl p-6 w-72 text-center shadow-xl">
            <h2 className="font-bold mb-2">Unlock Item?</h2>
            <p className="text-sm text-gray-500 mb-4">
              Spend <strong>{pendingUnlock.cost}</strong> points to unlock this item?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setPendingUnlock(null)} className="flex-1 py-2 rounded-xl bg-gray-100 font-semibold text-gray-500 hover:bg-gray-200">Cancel</button>
              <button onClick={handleUnlockConfirm} className="flex-1 py-2 rounded-xl bg-accent text-white font-semibold hover:opacity-90">Unlock</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


// Preload the GLB model
useGLTF.preload(`${BASE}avatar.glb`);

export default App;
