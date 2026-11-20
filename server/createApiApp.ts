import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

import {
  formatQuantity,
  normalizeIngredientMeta,
  normalizeUnit,
} from '../src/lib/inventoryUtils.ts';

import {
  calculateRecipeCostBreakdown,
  detectHomeAvailableClaims,
  optimizeOptionalIngredientsForBudget,
} from '../src/lib/recipeCostEngine.ts';

import type {
  InventoryItem,
  RecipeIngredient,
  RecipePurchaseItem,
} from '../src/types.ts';

const MODEL_NAME = 'gemini-4-hydrogen';
const FALLBACK_MODEL_NAME = 'gemini-3.1-flash-lite';
let primaryCooldownUntil = 0;

// =============================================================================
// Environment, App URL, CORS & Firebase Token Security Helpers
// =============================================================================

function loadFirebaseProjectId(): string {
  if (process.env.FIREBASE_PROJECT_ID) {
    return process.env.FIREBASE_PROJECT_ID;
  }
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(process.cwd(), '..', 'firebase-applet-config.json'),
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { projectId?: string };
        if (raw.projectId) return raw.projectId;
      }
    } catch {
      // Fallback below
    }
  }
  return 'gen-lang-client-0566681696';
}

const FIREBASE_PROJECT_ID = loadFirebaseProjectId();
const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedCerts: Record<string, string> = {};
let certsExpiresAt = 0;

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  if (Date.now() < certsExpiresAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }
  const resp = await fetch(FIREBASE_CERTS_URL);
  if (!resp.ok) {
    throw new Error(`Failed to fetch Firebase public certificates (${resp.status})`);
  }
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch?.[1] ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = (await resp.json()) as Record<string, string>;
  certsExpiresAt = Date.now() + Math.max(60, maxAgeSec) * 1000;
  return cachedCerts;
}

function decodeBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf8');
}

function decodeBase64UrlBuffer(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

interface VerifiedFirebaseUser {
  uid: string;
  email?: string;
}

async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseUser> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token.');
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(decodeBase64Url(headerB64)) as { alg?: string; kid?: string };
  const payload = JSON.parse(decodeBase64Url(payloadB64)) as {
    iss?: string;
    aud?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported Firebase token header.');
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= nowSec - 30) {
    throw new Error('Firebase ID token has expired.');
  }
  if (!payload.iat || payload.iat > nowSec + 300) {
    throw new Error('Firebase ID token issued-at timestamp is invalid.');
  }
  if (payload.aud !== FIREBASE_PROJECT_ID) {
    throw new Error('Firebase ID token audience mismatch.');
  }
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) {
    throw new Error('Firebase ID token issuer mismatch.');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Firebase ID token subject missing.');
  }

  const certs = await getFirebasePublicCerts();
  const certPem = certs[header.kid];
  if (!certPem) {
    // Refresh certs once in case Google rotated keys
    certsExpiresAt = 0;
    const freshCerts = await getFirebasePublicCerts();
    const retryCert = freshCerts[header.kid];
    if (!retryCert) {
      throw new Error('Firebase token signing key not recognized.');
    }
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    if (!verifier.verify(retryCert, decodeBase64UrlBuffer(signatureB64))) {
      throw new Error('Invalid Firebase ID token signature.');
    }
    return { uid: payload.sub, email: payload.email };
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  if (!verifier.verify(certPem, decodeBase64UrlBuffer(signatureB64))) {
    throw new Error('Invalid Firebase ID token signature.');
  }

  return { uid: payload.sub, email: payload.email };
}

function normalizeConfiguredUrl(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === 'MY_APP_URL') return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function resolveAppUrl(req?: Request): string {
  const configured =
    normalizeConfiguredUrl(process.env.APP_URL) ||
    normalizeConfiguredUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    normalizeConfiguredUrl(process.env.VERCEL_URL);
  if (configured) return configured;

  if (req) {
    const protoHeader = req.headers['x-forwarded-proto'];
    const proto = Array.isArray(protoHeader)
      ? protoHeader[0]
      : (protoHeader?.split(',')[0]?.trim() || req.protocol || 'http');
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host;
    const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
    if (host) return `${proto}://${host}`;
  }
  return 'http://localhost:3000';
}

function getConfiguredAllowedOrigins(): Set<string> {
  const origins = new Set<string>([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);

  const candidates = [
    normalizeConfiguredUrl(process.env.APP_URL),
    normalizeConfiguredUrl(process.env.VERCEL_URL),
    normalizeConfiguredUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    ...(process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => normalizeConfiguredUrl(s)),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      // Ignore malformed origin values
    }
  }
  return origins;
}

function isAllowedOrigin(origin: string, req: Request): boolean {
  const configured = getConfiguredAllowedOrigins();
  if (configured.has(origin)) return true;

  try {
    const parsed = new URL(origin);
    const reqHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
    if (reqHost && parsed.host.toLowerCase() === reqHost) {
      return true;
    }
    if (parsed.protocol === 'https:') {
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname.endsWith('.vercel.app') ||
        hostname.endsWith('.run.app') ||
        hostname.endsWith('.aistudio.google.com')
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function authenticateApiRequest(req: Request, res: Response, next: NextFunction) {
  const requireAuth = process.env.REQUIRE_FIREBASE_AUTH === 'true';
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    if (requireAuth) {
      return res.status(401).json({
        error: 'Authentication required. Please sign in to continue.',
        retryable: false,
      });
    }
    return next();
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    return res.status(401).json({
      error: 'Invalid Authorization header format.',
      retryable: false,
    });
  }

  try {
    const user = await verifyFirebaseIdToken(match[1].trim());
    (req as Request & { firebaseUser?: VerifiedFirebaseUser }).firebaseUser = user;
    return next();
  } catch (err) {
    console.warn('[auth] Rejected invalid Firebase token:', err instanceof Error ? err.message : err);
    return res.status(401).json({
      error: 'Your session expired or could not be verified. Please sign in again.',
      retryable: false,
    });
  }
}

// =============================================================================
// Gemini Client, Retry, Fallback & Error Formatting
// =============================================================================

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractUpstreamErrorDetails(err: unknown): { code?: number; statusText?: string; rawMessage: string } {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const statusFromErr = (err as { status?: number; code?: number })?.status || (err as { code?: number })?.code;

  try {
    const parsed = JSON.parse(rawMessage);
    if (parsed?.error) {
      return {
        code: Number(parsed.error.code) || statusFromErr,
        statusText: String(parsed.error.status || ''),
        rawMessage: String(parsed.error.message || rawMessage),
      };
    }
  } catch {
    const jsonStart = rawMessage.indexOf('{');
    if (jsonStart !== -1) {
      try {
        const parsed = JSON.parse(rawMessage.slice(jsonStart));
        if (parsed?.error) {
          return {
            code: Number(parsed.error.code) || statusFromErr,
            statusText: String(parsed.error.status || ''),
            rawMessage: String(parsed.error.message || rawMessage),
          };
        }
      } catch {
        // Not valid JSON
      }
    }
  }

  return {
    code: typeof statusFromErr === 'number' ? statusFromErr : undefined,
    rawMessage,
  };
}

function isTransientError(err: unknown): boolean {
  const { code, statusText, rawMessage } = extractUpstreamErrorDetails(err);
  const upper = `${statusText || ''} ${rawMessage}`.toUpperCase();
  if (code && [429, 500, 502, 503, 504].includes(code)) return true;
  return (
    upper.includes('503') ||
    upper.includes('502') ||
    upper.includes('500') ||
    upper.includes('429') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED') ||
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('ECONNRESET') ||
    upper.includes('ETIMEDOUT') ||
    upper.includes('FETCH FAILED')
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isQuotaOrRateLimitError(err: unknown): boolean {
  const { code, statusText, rawMessage } = extractUpstreamErrorDetails(err);
  const upper = `${statusText || ''} ${rawMessage}`.toUpperCase();
  return code === 429 || upper.includes('429') || upper.includes('RESOURCE_EXHAUSTED') || upper.includes('QUOTA');
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ETIMEDOUT: ${label} exceeded ${ms}ms`)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function callGeminiWithRetry<T>(operation: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (isQuotaOrRateLimitError(err) && extractUpstreamErrorDetails(err).rawMessage.toLowerCase().includes('per day')) {
        throw err;
      }
      if (attempt < maxRetries && isTransientError(err)) {
        const baseDelay = 650 * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 350);
        await sleep(baseDelay + jitter);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function generateContentWithFallback<T>(
  runWithModel: (model: string) => Promise<T>,
  primaryTimeoutMs = 10000,
): Promise<T> {
  const useFallbackFirst = Date.now() < primaryCooldownUntil;
  if (useFallbackFirst) {
    return await callGeminiWithRetry(() => withTimeout(runWithModel(FALLBACK_MODEL_NAME), 20000, FALLBACK_MODEL_NAME));
  }

  try {
    return await withTimeout(runWithModel(MODEL_NAME), primaryTimeoutMs, MODEL_NAME);
  } catch (err) {
    if (isQuotaOrRateLimitError(err) || isTransientError(err)) {
      primaryCooldownUntil = Date.now() + 5 * 60 * 1000;
      return await callGeminiWithRetry(() => withTimeout(runWithModel(FALLBACK_MODEL_NAME), 20000, FALLBACK_MODEL_NAME));
    }
    throw err;
  }
}

function formatGeminiError(err: unknown): { status: number; message: string; retryable: boolean } {
  const { code, statusText, rawMessage } = extractUpstreamErrorDetails(err);
  const upper = `${statusText || ''} ${rawMessage}`.toUpperCase();

  if (rawMessage.includes('GEMINI_API_KEY is not configured')) {
    return {
      status: 500,
      message: 'Gemini API key is missing on the server. Please configure GEMINI_API_KEY in server environment variables.',
      retryable: false,
    };
  }
  if (code === 403 || upper.includes('PERMISSION_DENIED') || upper.includes('API_KEY_INVALID')) {
    return {
      status: 403,
      message: 'Gemini API key permission error. Please check your server GEMINI_API_KEY configuration.',
      retryable: false,
    };
  }
  if (code === 503 || upper.includes('503') || upper.includes('UNAVAILABLE') || upper.includes('HIGH DEMAND')) {
    return {
      status: 503,
      message: 'Your food buddy is a bit busy due to high AI demand right now. Your message is safe — please tap Retry!',
      retryable: true,
    };
  }
  if (code === 429 || upper.includes('429') || upper.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: 'Too many requests right now. Give it a few seconds and tap Retry.',
      retryable: true,
    };
  }
  if (code === 502 || code === 504 || code === 500 || upper.includes('FETCH FAILED') || upper.includes('ETIMEDOUT')) {
    return {
      status: code || 502,
      message: 'Temporary connection hiccup with the AI kitchen server. Please tap Retry.',
      retryable: true,
    };
  }
  if (code === 404 || upper.includes('404') || upper.includes('NOT_FOUND')) {
    return {
      status: 404,
      message: `Requested Gemini model (${MODEL_NAME}) was not found.`,
      retryable: false,
    };
  }
  return {
    status: 500,
    message: 'Something went wrong reaching the AI companion. Please tap Retry.',
    retryable: true,
  };
}

// =============================================================================
// Domain Types & Cost / Budget / State Helpers
// =============================================================================

interface InventoryInput {
  name: string;
  canonicalName?: string;
  displayName?: string;
  quantity: string;
  numericQuantity?: number;
  unit?: string;
  category: string;
  isRegular: boolean;
  isAvailable: boolean;
}

interface TransactionInput {
  ingredientName: string;
  actionType: string;
  deltaQuantity: number;
  unit: string;
  note: string;
}

interface ProfileInput {
  displayName: string;
  buddyName: string;
  humourLevel?: string;
  conversationStyle?: string;
  preferredLanguage: string;
  dietaryPreference: string;
  spiceTolerance: string;
  favouriteCuisines: string[];
  allergies: string[];
  dislikedIngredients: string[];
  defaultEquipment: string;
  defaultUtensils: string;
  defaultServings: number;
  preferredPrepTime: string;
  defaultBudget: number | null;
  hasExplicitDefaultBudget?: boolean;
  recentMeals: string[];
  memoryNotes?: string[];
}

interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

type ConversationState =
  | 'IDLE'
  | 'INVENTORY_UPDATE'
  | 'FOOD_DISCOVERY'
  | 'DISH_DISCOVERY'
  | 'RECIPE_SELECTED'
  | 'RECIPE_GENERATION'
  | 'COOKING_MODE';

type ChatResponseMode =
  | 'INVENTORY_UPDATE'
  | 'FOOD_DISCOVERY'
  | 'DISH_DISCOVERY'
  | 'RECIPE_SELECTED'
  | 'GENERAL_CHAT';

interface SuggestedDishInput {
  dishName: string;
  cuisine: string;
  shortPitch: string;
  prepCookTime: string;
  servings?: number;
  estimatedExtraCostInr: number;
  usesExistingOnly?: boolean;
  matchReason: string;
  imageCategory: 'north_indian' | 'street_food' | 'indo_chinese' | 'kitchen';
  requiredIngredients?: RecipeIngredient[];
  availableIngredients?: string[];
  missingIngredients?: RecipePurchaseItem[];
  ingredientConsumptionValueInr?: number;
  missingIngredientValueInr?: number;
  actualShoppingOutlayInr?: number;
  fitsActiveBudget?: boolean;
  substitutionsNote?: string;
}

interface DiscoveryContextInput {
  mood?: string;
  craving?: string;
  recentMealNote?: string;
  timeAvailable?: string;
  shoppingPreference?: string;
  activeBudget?: number | null;
  lastSuggestedDishes?: SuggestedDishInput[];
  rejectedDishes?: string[];
  selectedDishName?: string;
  turnsInDiscovery?: number;
}

const INVENTORY_MUTATION_ACTIONS = new Set([
  'ADD_INGREDIENT',
  'UPDATE_QUANTITY',
  'REMOVE_INGREDIENT',
  'MARK_UNAVAILABLE',
  'CONSUME_INGREDIENT',
  'RESTOCK_INGREDIENT',
]);

type BudgetIntent =
  | { action: 'SET'; amount: number }
  | { action: 'TIGHTEN'; rejectedAmount?: number }
  | { action: 'CLEAR' }
  | { action: 'NONE' };

function parseBudgetIntent(text: string): BudgetIntent {
  if (
    /\b(budget\s*(ki\s*)?(tension|chinta|fikar|parwah)\s*(mat|nahi|na)|no\s*budget(\s*limit|\s*cap|\s*restriction)?|koi\s*budget\s*nahi|budget\s*(hata|remove|clear|cancel|mat\s*dekh|mat\s*rakh|chor|chhod)|forget\s*(the\s*)?budget|without\s*(any\s*)?budget|unlimited\s*budget|free\s*budget)\b/i.test(
      text,
    )
  ) {
    return { action: 'CLEAR' };
  }

  if (
    /\b(no\s*shopping|kuch\s*(?:bhi\s*)?(?:(?:nahi|mat)\s*kharid(?:na|o)?|kharid(?:na|o)?\s*(?:nahi|mat))|jo\s*hai\s*usi\s*se|sirf\s*ghar\s*(ke|wale)\s*saman|bina\s*kharide|zero\s*budget)\b/i.test(
      text,
    ) ||
    /(?:₹|rs\.?)\s*0\b/i.test(text) ||
    /\b0\s*(?:₹|rs\.?|rupaye|rupees)\b/i.test(text)
  ) {
    return { action: 'SET', amount: 0 };
  }

  const rejectionAmountMatch = text.match(
    /(?:₹|rs\.?)?\s*(\d{1,5})\s*(?:₹|rs\.?|rupaye|rupees)?\s*(?:zyada|jyada|mahanga|mehnga|too\s*much|expensive|high|ho\s*jayega|lag\s*jayega)/i,
  );
  if (rejectionAmountMatch?.[1]) {
    return { action: 'TIGHTEN', rejectedAmount: Number(rejectionAmountMatch[1]) };
  }

  const rupeeMatch =
    text.match(/(?:₹|rs\.?|rupaye|rupees)\s*(\d{1,5})\b/i) ||
    text.match(/\b(\d{1,5})\s*(?:₹|rs\.?|rupaye|rupees|ke\s*andar)\b/i) ||
    text.match(/\bbudget(?:\s*(?:is|hai|ka|limit|cap|set|kar\s*de|to))?\s*(?:₹|rs\.?)?\s*(\d{1,5})\b/i) ||
    text.match(
      /\b(?:have|paas|sirf|spend|under|within|andar|mein)\s*(?:₹|rs\.?)?\s*(\d{1,5})\s*(?:₹|rs\.?|rupaye|rupees|to\s*spend|ke\s*andar|hain)?\b/i,
    );

  if (rupeeMatch?.[1]) {
    const parsed = Number(rupeeMatch[1]);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 10000) {
      return { action: 'SET', amount: Math.round(parsed) };
    }
  }

  if (
    /\b(itna\s*kharcha\s*nahi|zyada\s*(kharcha|mehnga|mahanga|ho\s*jayega)|kuch\s*sasta|cheaper|kam\s*(paise|kharch|budget)|tight\s*budget|low\s*budget)\b/i.test(
      text,
    )
  ) {
    return { action: 'TIGHTEN' };
  }

  return { action: 'NONE' };
}

function toEngineInventory(inventory: InventoryInput[]): InventoryItem[] {
  return inventory.map((i, idx) => {
    const meta = normalizeIngredientMeta(i.displayName || i.name, (i.category || 'Other') as InventoryItem['category']);
    return {
      id: `inv_srv_${idx}`,
      userId: 'srv',
      canonicalName: (i.canonicalName || meta.canonicalName).toLowerCase(),
      displayName: i.displayName || i.name,
      name: i.name,
      quantity: i.quantity,
      numericQuantity: i.numericQuantity,
      unit: i.unit ? normalizeUnit(i.unit) : meta.defaultUnit,
      category: meta.category,
      isRegular: Boolean(i.isRegular),
      isAvailable: Boolean(i.isAvailable),
    };
  });
}

function applyHomeClaimsInMemory(
  baseInventory: InventoryInput[],
  claims: Array<{ canonicalName: string; displayName: string; quantity: number; unit: string }>,
): InventoryInput[] {
  if (!claims.length) return baseInventory;
  const copy = baseInventory.map((i) => ({ ...i }));
  for (const claim of claims) {
    const idx = copy.findIndex((item) => {
      const canon = (item.canonicalName || normalizeIngredientMeta(item.name).canonicalName).toLowerCase();
      return canon === claim.canonicalName.toLowerCase();
    });
    const qtyText = formatQuantity(claim.quantity, claim.unit);
    const meta = normalizeIngredientMeta(claim.displayName);
    if (idx >= 0) {
      copy[idx] = {
        ...copy[idx],
        canonicalName: claim.canonicalName,
        displayName: copy[idx].displayName || claim.displayName,
        isAvailable: true,
        numericQuantity: Math.max(copy[idx].numericQuantity || 0, claim.quantity),
        unit: claim.unit,
        quantity: (copy[idx].numericQuantity || 0) > 0 ? copy[idx].quantity : qtyText,
      };
    } else {
      copy.push({
        name: claim.displayName,
        canonicalName: claim.canonicalName,
        displayName: claim.displayName,
        quantity: qtyText,
        numericQuantity: claim.quantity,
        unit: claim.unit,
        category: meta.category,
        isRegular: true,
        isAvailable: true,
      });
    }
  }
  return copy;
}

function enrichDishWithCostEngine(
  dish: SuggestedDishInput,
  engineInventory: InventoryItem[],
  activeBudget: number | null,
  defaultServings = 2,
): SuggestedDishInput {
  const rawIngs: RecipeIngredient[] =
    Array.isArray(dish.requiredIngredients) && dish.requiredIngredients.length > 0
      ? dish.requiredIngredients
      : [];

  if (rawIngs.length === 0) {
    const fallbackOutlay = Math.max(0, Math.round(Number(dish.estimatedExtraCostInr || 0)));
    return {
      ...dish,
      servings: dish.servings || defaultServings,
      estimatedExtraCostInr: fallbackOutlay,
      actualShoppingOutlayInr: fallbackOutlay,
      usesExistingOnly: fallbackOutlay === 0,
      fitsActiveBudget: activeBudget === null ? true : fallbackOutlay <= activeBudget,
    };
  }

  const { optimizedIngredients, breakdown, droppedOptionalNames } =
    optimizeOptionalIngredientsForBudget(rawIngs, engineInventory, activeBudget);

  const subNote =
    droppedOptionalNames.length > 0
      ? `Skipped optional items (${droppedOptionalNames.join(', ')}) to fit ₹${activeBudget} budget.`
      : dish.substitutionsNote;

  return {
    ...dish,
    servings: dish.servings || defaultServings,
    requiredIngredients: optimizedIngredients,
    availableIngredients: breakdown.availableIngredients,
    missingIngredients: breakdown.missingIngredients,
    ingredientConsumptionValueInr: breakdown.ingredientConsumptionValueInr,
    missingIngredientValueInr: breakdown.missingIngredientValueInr,
    actualShoppingOutlayInr: breakdown.actualShoppingOutlayInr,
    estimatedExtraCostInr: breakdown.actualShoppingOutlayInr,
    usesExistingOnly: breakdown.usesExistingOnly,
    fitsActiveBudget: breakdown.fitsActiveBudget,
    ...(subNote ? { substitutionsNote: subNote } : {}),
  };
}

function resolveSelectedDishFromText(
  message: string,
  candidates: SuggestedDishInput[] = [],
  modelSelectedName?: string,
): string | undefined {
  if (!candidates.length) return modelSelectedName || undefined;

  if (modelSelectedName) {
    const exact = candidates.find(
      (c) => c.dishName.toLowerCase() === modelSelectedName.trim().toLowerCase(),
    );
    if (exact) return exact.dishName;
    const partial = candidates.find(
      (c) =>
        c.dishName.toLowerCase().includes(modelSelectedName.trim().toLowerCase()) ||
        modelSelectedName.trim().toLowerCase().includes(c.dishName.toLowerCase()),
    );
    if (partial) return partial.dishName;
  }

  const lower = message.toLowerCase();
  if (/\b(pehla|pehle|first|1st|option\s*1|#1|one)\b/i.test(lower) && candidates[0]) {
    return candidates[0].dishName;
  }
  if (/\b(doosra|dusra|second|2nd|option\s*2|#2|two)\b/i.test(lower) && candidates[1]) {
    return candidates[1].dishName;
  }
  if (/\b(teesra|tisra|third|3rd|option\s*3|#3|three)\b/i.test(lower) && candidates[2]) {
    return candidates[2].dishName;
  }
  const byDishName = candidates.find((c) => lower.includes(c.dishName.toLowerCase()));
  return byDishName?.dishName || modelSelectedName || undefined;
}

function keepCrispConfirmation(reply: string): string {
  const cleaned = reply.replace(/\n+/g, ' ').trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) || [];
  if (sentences.length <= 2) return cleaned;
  return sentences.slice(0, 2).join(' ');
}

function buildUserContextBlock(
  profile: ProfileInput,
  inventory: InventoryInput[],
  recentTransactions: TransactionInput[] = [],
): { contextBlock: string; isKitchenEmpty: boolean } {
  const availableItems = inventory
    .filter((i) => i.isAvailable && (i.numericQuantity === undefined || i.numericQuantity > 0))
    .map(
      (i) =>
        `- ${i.displayName || i.name} [canonical: ${i.canonicalName || i.name}] — ${i.quantity} (${i.category}${i.isRegular ? ', regular staple' : ''})`,
    );

  const outOfStockItems = inventory
    .filter((i) => !i.isAvailable || i.numericQuantity === 0)
    .map((i) => `- ${i.displayName || i.name} (OUT OF STOCK / 0)`);

  const recentTxLines = recentTransactions
    .slice(0, 8)
    .map((t) => `- ${t.actionType}: ${t.note}`);

  const isKitchenEmpty = availableItems.length === 0;

  const contextBlock = `
USER PROFILE & PERSONALITY SETTINGS:
- User Name: ${profile.displayName || 'Friend'}
- Your Assigned Companion Name: "${profile.buddyName || 'KhanaBanana'}"
- Preferred Language Style: ${profile.preferredLanguage || 'Hinglish'}
- Humour Level: ${profile.humourLevel || 'Friendly teasing'} (Mild = warm gentle humour; Friendly teasing = witty buddy banter; Full-on desi dost = expressive, cheeky Indian friend energy, always respectful)
- Conversation Style: ${profile.conversationStyle || 'Warm & Detailed'}
- Dietary Preference: ${profile.dietaryPreference || 'Vegetarian'}
- Spice Tolerance: ${profile.spiceTolerance || 'Medium'}
- Favourite Cuisines: ${profile.favouriteCuisines?.length ? profile.favouriteCuisines.join(', ') : 'North Indian, Street Food, Everyday Bachelor'}
- Allergies (STRICT AVOID): ${profile.allergies?.length ? profile.allergies.join(', ') : 'None'}
- Disliked Ingredients (AVOID): ${profile.dislikedIngredients?.length ? profile.dislikedIngredients.join(', ') : 'None'}
- Default Cooking Equipment: ${profile.defaultEquipment || 'Gas Stove'}
- Default Utensils: ${profile.defaultUtensils || 'One Pan / Kadhai'}
- Default Servings: ${profile.defaultServings || 2}
- Preferred Prep Time: ${profile.preferredPrepTime || '15-30 mins'}${
    profile.hasExplicitDefaultBudget &&
    profile.defaultBudget !== null &&
    profile.defaultBudget !== undefined
      ? `\n- Saved Default Shopping Budget Preference: ₹${profile.defaultBudget}`
      : ''
  }
- Recent Meals Eaten (Yesterday / Recent History — AVOID REPEATING THESE): ${profile.recentMeals?.length ? profile.recentMeals.join(', ') : 'None logged yet'}
- Persistent Long-Term Memory Notes (NEVER ERASED BY CHAT CLEAR): ${profile.memoryNotes?.length ? profile.memoryNotes.join(' | ') : 'None yet'}

MY KITCHEN LIVE INVENTORY (SOURCE OF TRUTH FROM FIRESTORE):
${availableItems.length > 0 ? availableItems.join('\n') : 'EMPTY KITCHEN — ZERO AVAILABLE INGREDIENTS IN MY KITCHEN.'}
${outOfStockItems.length > 0 ? `\nCURRENTLY OUT OF STOCK:\n${outOfStockItems.join('\n')}` : ''}
${recentTxLines.length > 0 ? `\nRECENT KITCHEN ACTIVITY LOG:\n${recentTxLines.join('\n')}` : ''}
`.trim();

  return { contextBlock, isKitchenEmpty };
}

// =============================================================================
// Shared Express App Factory (Used by both /server.ts and Vercel /api/*.ts)
// =============================================================================

export function createApiApp() {
  const app = express();
  app.set('trust proxy', 1);

  // Security headers + CORS for /api/* routes
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');

    const origin = req.headers.origin;
    if (origin) {
      if (!isAllowedOrigin(origin, req)) {
        return res.status(403).json({ error: 'Origin not allowed by CORS policy.', retryable: false });
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '86400');
    }

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  });

  // Vercel-safe JSON body middleware: Vercel runtime may pre-parse req.body before invoking handler
  const jsonParser = express.json({ limit: '2mb' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (typeof req.body === 'string' && req.body.trim().length > 0) {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON request body.', retryable: false });
      }
      return next();
    }
    if (req.body !== undefined) {
      return next();
    }
    return jsonParser(req, res, next);
  });

  // Health Endpoint
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'KhanaBanana API',
      environment: process.env.VERCEL ? 'vercel' : 'node',
      appUrl: resolveAppUrl(req),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      firebaseProjectId: FIREBASE_PROJECT_ID,
      authRequired: process.env.REQUIRE_FIREBASE_AUTH === 'true',
      timestamp: new Date().toISOString(),
    });
  });

  // ===========================================================================
  // 1. Conversational Kitchen Intelligence + 3-Mode State Orchestration
  // ===========================================================================
  app.post('/api/chat', authenticateApiRequest, async (req: Request, res: Response) => {
    try {
      const {
        message,
        history = [],
        profile,
        inventory = [],
        recentTransactions = [],
        lastSuggestedShoppingList = [],
        activeBudgetOverride,
        conversationState = 'IDLE',
        discoveryContext = {},
      } = (req.body || {}) as {
        message: string;
        history?: HistoryMessage[];
        profile: ProfileInput;
        inventory?: InventoryInput[];
        recentTransactions?: TransactionInput[];
        lastSuggestedShoppingList?: { name: string; quantity: string; estimatedCostInr?: number }[];
        activeBudgetOverride?: number | null;
        conversationState?: ConversationState;
        discoveryContext?: DiscoveryContextInput;
      };

      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'Message text is required.', retryable: false });
      }
      if (/^\/\*?clear$/i.test(message.trim())) {
        return res.json({
          intentMode: 'GENERAL_CHAT',
          nextConversationState: 'IDLE',
          updatedDiscoveryContext: {},
          reply: 'Chat saaf kar diya bhai! Baaki sab yaad hai. Tera kitchen, teri preferences aur purani food history safe hai.',
          inventoryActions: [],
          includeBudgetPlan: false,
          suggestedDishes: [],
          detectedMealsEatenRecently: [],
          isClearCommand: true,
        });
      }
      if (!profile) {
        return res.status(400).json({ error: 'User profile context is required.', retryable: false });
      }

      const buddyName = profile.buddyName || 'KhanaBanana';
      const lastSuggestedDishes = Array.isArray(discoveryContext.lastSuggestedDishes)
        ? discoveryContext.lastSuggestedDishes
        : [];
      const rejectedDishes = Array.isArray(discoveryContext.rejectedDishes)
        ? discoveryContext.rejectedDishes
        : [];

      const contextMissingNames = lastSuggestedDishes.flatMap((d) =>
        (d.missingIngredients || []).map((m) => m.name),
      );
      const homeAvailableClaims = detectHomeAvailableClaims(message, contextMissingNames);
      const effectiveInventoryForTurn = applyHomeClaimsInMemory(inventory, homeAvailableClaims);
      const engineInventoryForTurn = toEngineInventory(effectiveInventoryForTurn);

      const { contextBlock, isKitchenEmpty } = buildUserContextBlock(
        profile,
        effectiveInventoryForTurn,
        recentTransactions,
      );

      const budgetIntent = parseBudgetIntent(message);
      const explicitDefaultBudget =
        profile.hasExplicitDefaultBudget &&
        profile.defaultBudget !== undefined &&
        profile.defaultBudget !== null
          ? profile.defaultBudget
          : null;

      let effectiveBudget: number | null = null;
      if (budgetIntent.action === 'CLEAR') {
        effectiveBudget = null;
      } else if (budgetIntent.action === 'SET') {
        effectiveBudget = budgetIntent.amount;
      } else if (budgetIntent.action === 'TIGHTEN') {
        const minPriorCost = lastSuggestedDishes.reduce((min, d) => {
          const c = Number(d.actualShoppingOutlayInr ?? d.estimatedExtraCostInr ?? 999);
          return c < min ? c : min;
        }, 999);
        const refCap = budgetIntent.rejectedAmount ?? (minPriorCost < 999 ? minPriorCost : 60);
        effectiveBudget = Math.max(0, Math.min(35, Math.floor((refCap - 5) / 5) * 5));
      } else if (activeBudgetOverride !== undefined) {
        effectiveBudget = activeBudgetOverride;
      } else if (discoveryContext.activeBudget !== undefined) {
        effectiveBudget = discoveryContext.activeBudget;
      } else {
        effectiveBudget = explicitDefaultBudget;
      }

      const persistentMealNote =
        discoveryContext.recentMealNote ||
        (profile.recentMeals?.length
          ? `Already remembered from persistent memory: ${profile.recentMeals.join(', ')} (DO NOT ask what they ate yesterday; explicitly acknowledge it and suggest something different!)`
          : 'Not asked yet');

      const persistentPreferenceNote =
        discoveryContext.craving ||
        (profile.memoryNotes?.length
          ? `Already remembered from persistent memory: ${profile.memoryNotes.join(', ')} (Spice tolerance: ${profile.spiceTolerance || 'Medium'})`
          : 'Not asked yet');

      const hasRichPersistentMemory =
        (profile.recentMeals?.length || 0) > 0 &&
        ((profile.memoryNotes?.length || 0) > 0 || Boolean(discoveryContext.craving));

      const budgetContextLine =
        effectiveBudget === null
          ? 'NONE (No budget limit! Do NOT restrict dishes or ingredients by ₹50 or ₹100. Recommend the best dishes naturally; any shopping cost mentioned is just a helpful estimate, NOT a cap.)'
          : effectiveBudget === 0
            ? '₹0 (STRICT NO SHOPPING — suggest ONLY dishes cookable 100% from existing My Kitchen ingredients!)'
            : `₹${effectiveBudget} (STRICT active additional shopping limit of ₹${effectiveBudget})`;

      const stateContextBlock = `
CURRENT CONVERSATION STATE MACHINE:
- Active State: ${conversationState}
- Collected Discovery Context:
  * Mood: ${discoveryContext.mood || (hasRichPersistentMemory ? 'Ready to suggest based on saved memory & kitchen' : 'Not asked yet')}
  * Craving / Taste: ${persistentPreferenceNote}
  * Recent Meal / Yesterday Note: ${persistentMealNote}
  * Time Available: ${discoveryContext.timeAvailable || 'Not specified'}
  * Shopping Preference: ${discoveryContext.shoppingPreference || 'Flexible'}
  * Active Budget Constraint: ${budgetContextLine}
  * Selected Dish (if recalculating recipe): ${discoveryContext.selectedDishName || 'None'}
  * Discovery Turns So Far: ${discoveryContext.turnsInDiscovery || 0}
- Previously Suggested Dishes (active selection pool):
  ${lastSuggestedDishes.length > 0 ? lastSuggestedDishes.map((d, idx) => `${idx + 1}. ${d.dishName} (${d.prepCookTime}, extra ₹${d.estimatedExtraCostInr})`).join('\n  ') : 'None'}
- Rejected Dishes (NEVER suggest these again unless asked):
  ${rejectedDishes.length > 0 ? rejectedDishes.join(', ') : 'None'}
`.trim();

      const lastShoppingContext =
        lastSuggestedShoppingList && lastSuggestedShoppingList.length > 0
          ? `LAST SUGGESTED SHOPPING LIST FROM PREVIOUS MESSAGE:\n${lastSuggestedShoppingList.map((i) => `- ${i.name} (${i.quantity})`).join('\n')}`
          : 'No prior pending shopping list.';

      const emptyKitchenDirective = isKitchenEmpty
        ? `
CRITICAL — EMPTY KITCHEN RULE:
My Kitchen currently has ZERO available ingredients!
- If the user is NOT adding ingredients in THIS message and asks what to eat ("Aaj kya khayein?", "Bhook lagi hai"), react like a real witty close friend noticing an empty kitchen (e.g., "Bhai pehle kitchen mein kuch bhar toh le! Khali pada hai tere kitchen mein... chal bata, basic groceries le aayega ya aaj kuch arrange karne ka plan hai?").
- Offer them to head to My Kitchen or tell you what groceries they bring.
- NEVER invent phantom ingredients, and NEVER return suggestedDishes when kitchen is empty!
`
        : '';

      const systemInstruction = `
You are "${buddyName}", the user's close Indian food friend and kitchen companion inside KhanaBanana (tagline: "Khana kya hai? Woh hum decide karenge.").

PERSONALITY & HUMANISED FRIEND BEHAVIOUR:
- Always embody "${buddyName}" naturally. Speak like a real friend, NOT an automated recipe generator.
- Language: ${profile.preferredLanguage || 'Hinglish'}.
- Humour Level: ${profile.humourLevel || 'Friendly teasing'}. Conversation Style: ${profile.conversationStyle || 'Warm & Detailed'}.
- Never insult personal traits or financial limits; keep humour warm and supportive.

${contextBlock}

${stateContextBlock}

${lastShoppingContext}

${emptyKitchenDirective}

=============================================================================
STRICT CONVERSATION MODE ORCHESTRATION (MOST IMPORTANT RULE IN THE ENTIRE APP)
=============================================================================
You MUST classify every user message into EXACTLY ONE "intentMode":

1. "INVENTORY_UPDATE" (MODE A — SILENT KITCHEN SYNC):
   Trigger ONLY when the user mentions buying, bringing groceries home, adding something to the kitchen, consuming/using an ingredient, running out ("khatam"), or correcting an existing quantity.
   Examples: "100gm onion v laya.", "500 gram aloo le aaya.", "Doodh khatam ho gaya.", "2 ande use kar liye.", "500g aloo mein se 200g use kar liya."
   STRICT RESPONSE POLICY FOR INVENTORY_UPDATE:
   - "reply" MUST be ONE SHORT FRIENDLY SENTENCE confirming the update (e.g., "Arey badhiya! 100g pyaaz bhi add kar liya. Note kar liya bhai.").
   - DO NOT suggest recipes!
   - DO NOT return suggestedDishes (MUST be empty [])!
   - DO NOT generate shopping lists or budget calculations ("includeBudgetPlan" MUST be false)!
   - DO NOT analyse remaining kitchen items or ask "Aaj kya pakana hai?".
   - If the user was already in FOOD_DISCOVERY or DISH_DISCOVERY and bought an ingredient mid-conversation, confirm ONLY the purchase in one short sentence and DO NOT lose their ongoing discovery context!

2. "FOOD_DISCOVERY" (MODE B — NATURAL ONE-QUESTION-AT-A-TIME DISCOVERY):
   Trigger ONLY when:
   - User initiates food decision ("Aaj kya khayein?", "Aaj kya banayein?", "Kuch banane ka mann hai", "Bhook lagi hai", "Suggest something") AND we do NOT yet have Recent Meals Eaten + Persistent Long-Term Memory Notes/Craving context, OR
   - User is still answering discovery questions and we have NOT yet collected enough context (craving/mood + recent meal avoidance), OR
   - User rejects options and wants to change craving ("Mood change hai", "Kuch aur taste bata", "Sab rehne de"), OR
   - Kitchen is empty and user asks what to eat.
   STRICT RESPONSE POLICY FOR FOOD_DISCOVERY:
   - Ask ONLY ONE natural conversational question per turn! Never fire a multi-question checklist!
   - If Recent Meals Eaten already has entries (e.g., Chicken) even in FOOD_DISCOVERY, NEVER ask "Kal kya khaya tha?" — explicitly reference what they ate ("Kal chicken khaya tha na?") and any kitchen items before asking today's mood.
   - Example progression (only when memory is empty):
     * User: "Aaj kya khayein?" -> Ask mood/taste ("Bhai pehle mood bata. Kuch chatpata aur spicy khane ka mann hai ya simple ghar jaisa khana?")
     * User: "Kuch spicy." -> Ask what they ate yesterday/recently ("Samajh gaya. Kal kya khaya tha? Same cheez repeat nahi karenge.")
     * User: "Kal dal chawal." -> NOW you have craving ("spicy") AND recent meal ("dal chawal")! Switch to MODE C ("DISH_DISCOVERY") and present 2-3 curated dishes!
   - NEVER dump recipes or dish cards during FOOD_DISCOVERY ("suggestedDishes" MUST be []).

3. "DISH_DISCOVERY" (MODE C — CURATED 2–3 DISH SELECTION CARDS):
   Trigger IMMEDIATELY when kitchen is NOT empty AND ANY of these hold:
   - Recent Meals Eaten is populated AND (Persistent Long-Term Memory Notes is populated OR Craving/Taste is known OR Spice Tolerance is explicit like Spicy/Extra Spicy), and the user asks "Aaj kya khayein?" / "Aaj kya banayein?" / "Kuch suggest kar" — EVEN IF chat history is completely empty after a chat clear!
   - You have gathered mood/craving + recent meal context from conversation.
   - User is already in DISH_DISCOVERY and says "Nahi, kuch aur bata" / "More options" (suggest 2-3 FRESH dishes, avoiding all rejectedDishes & previously shown dishes!).
   - User sets, changes, or clears budget while in DISH_DISCOVERY (e.g., "Budget ₹50 kar de", "₹0 mein bata", "Budget ki tension mat le") -> refresh 2-3 suitable dishes ${effectiveBudget === null ? 'freely without any budget restriction' : `within ₹${effectiveBudget}`} using their existing mood/craving context without restarting!
   STRICT RESPONSE POLICY FOR DISH_DISCOVERY:
   - Inspect MY KITCHEN LIVE INVENTORY carefully and use real items from it (e.g. aloo/potato, etc.).
   - ${effectiveBudget === null ? 'BUDGET IS NONE (UNRESTRICTED): Do NOT impose any ₹50 or ₹100 spending limit! Recommend the best dishes using existing items smartly; mention approximate extra cost honestly based on missing items, NEVER as a spending cap.' : effectiveBudget === 0 ? 'BUDGET IS ₹0 (NO SHOPPING): Prioritize dishes cookable from existing My Kitchen inventory. NEVER omit essential ingredients (oil, salt) just to pretend ₹0 — if essential items like oil or salt are missing in My Kitchen, state honestly that they are needed unless already at home.' : `ACTIVE BUDGET CONSTRAINT IS ₹${effectiveBudget}: Prioritize dishes whose missing essentials fit within ₹${effectiveBudget}, skipping optional items if needed, and NEVER omit essential oil/salt to fake lower cost.`}
   - If Recent Meals Eaten has any items (e.g., "Chicken"), you MUST explicitly mention avoiding it in "reply" (e.g., "Kal chicken khaya tha na? Aaj kuch different aur spicy try karein! Tere kitchen mein jo aloo aur baaki saman hai usse ye options mast banenge.") and NEVER suggest repeating that meal!
   - Return ONLY 2 to 3 carefully selected dishes in "suggestedDishes" (NEVER dump all possible recipes, NEVER write full recipe steps!).
   - CRITICAL COST & INGREDIENT HONESTY RULE:
     * For EVERY dish in "suggestedDishes", populate "servings" (${profile.defaultServings || 2}) AND "requiredIngredients" with EVERY realistic ingredient required to cook the dish (including oil/ghee, salt, green chillies, turmeric, cumin, garam masala, red chilli powder, etc. — NEVER omit cooking oil, salt, or spices just to pretend cost is ₹0!).
     * Set "isEssential: true" on core structural items (main veg/protein/grain, cooking oil, salt) and "isEssential: false" on optional flavour enhancers/garnishes (coriander, garam masala, optional ginger, extra garnish).
     * Remember: our backend cost engine deterministically calculates exact availability, pack prices, and ₹ outlay from "requiredIngredients" vs MY KITCHEN LIVE INVENTORY! Never promise "₹0 extra" in "reply" if oil, salt, chillies, or spices are missing from MY KITCHEN LIVE INVENTORY!
     * If user is negotiating ("20 ke andar bata", "100 rupaye zyada ho jayega", "Oil toh ghar mein hai", "Masale bhi hain", "Kuch bhi kharidna nahi"), stay in DISH_DISCOVERY and return updated 2-3 dishes reflecting the newly claimed home items or tighter ₹ budget honestly (explaining clearly if even the simplest dish still needs an essential missing item like oil or salt).
   - Set "includeBudgetPlan": false unless user explicitly asks for a separate shopping list.

4. "RECIPE_SELECTED" (MODE D — USER PICKED A DISH OR RECALCULATING SELECTED RECIPE):
   Trigger ONLY when:
   - User is selecting one of the Previously Suggested Dishes (e.g., "Pehla wala banate hain", "Second option", "Aloo Pyaaz Masala Rice bana de", "Option 3"), OR
   - Active State is ALREADY "RECIPE_SELECTED" with a Selected Dish (${discoveryContext.selectedDishName || 'None'}) and user updates budget OR says an item is at home ("Mera budget ₹50 hai.", "Oil toh ghar mein hai.", "Budget ki tension mat le.").
   STRICT RESPONSE POLICY FOR RECIPE_SELECTED:
   - Set "selectedDishName" to the exact dishName!
   - If updating budget or home-available items for an already-selected dish, confirm warmly in 1-2 crisp sentences; otherwise give one enthusiastic confirmation sentence ("Done bhai! Tera <dishName> ka complete recipe card khol raha hoon.").
   - "suggestedDishes" MUST be [], "includeBudgetPlan" MUST be false.

5. "GENERAL_CHAT":
   Use for:
   - Greetings ("Hi", "Hello"), kitchen queries ("Kitchen mein kya hai?" -> QUERY_INVENTORY), setting or clearing budget from IDLE ("Budget ₹50 hai", "Budget ki tension mat le" when not discussing dishes yet).
   - Recording factual past meals or lasting preferences WITHOUT asking to cook right now (e.g., "Kal chicken khaya tha.", "Mujhe spicy food pasand hai.") -> confirm warmly in 1-2 sentences that you saved it to long-term memory, with suggestedDishes: [].
   - Answering memory recall questions even with an empty chat transcript (e.g., "Kal kya khaya tha?", "Mujhe kaisa khana pasand hai?") -> check Recent Meals Eaten, Spice Tolerance, Dietary Preference, Favourite Cuisines, Allergies, Dislikes, and Persistent Long-Term Memory Notes from the user profile above and answer accurately and warmly!
   - NEVER mention budget limits in greetings, general conversations, food gossip, inventory updates, or previous meal queries!

=============================================================================
PART A — INVENTORY ACTION CLASSIFICATION RULES
=============================================================================
Allowed "action" values in "inventoryActions":
- ADD_INGREDIENT (set isPurchase: true if bought/brought)
- UPDATE_QUANTITY
- CONSUME_INGREDIENT
- MARK_UNAVAILABLE (set quantity: 0)
- RESTOCK_INGREDIENT
- REMOVE_INGREDIENT
- QUERY_INVENTORY
- NO_INVENTORY_ACTION

Rules:
1. NEVER add ingredients merely because they are mentioned in a craving or recipe idea ("pizza khane ka mann hai" -> NO_INVENTORY_ACTION).
2. Handle partial shopping list confirmations ("Paneer, pyaaz aur tamatar le aaya, baaki nahi mila" -> emit ADD_INGREDIENT ONLY for those 3).
3. Normalize canonicalName in lowercase English: aloo->potato, pyaaz->onion, tamatar->tomato, doodh->milk, chawal->rice, atta->wheat flour, anda->egg, hari mirch->green chilli, dhaniya->coriander, adrak->ginger, lehsun->garlic, tel->cooking oil, namak->salt, haldi->turmeric, jeera->cumin, dahi->curd.
4. Normalize units: g, kg, ml, L, pieces, packets, tbsp, tsp, cups, bunch.
5. If quantity is missing on an add/consume where quantity is essential ("Aloo laya"), set needsClarification: true with a short clarificationQuestion. ("Doodh khatam ho gaya" -> MARK_UNAVAILABLE needs no quantity).

=============================================================================
PART B — PERSISTENT LONG-TERM MEMORY EXTRACTION (SURVIVES CHAT CLEAR)
=============================================================================
Always populate:
1. "detectedMealsEatenRecently": Whenever the user mentions what they ate yesterday or recently (e.g. "Kal chicken khaya tha." -> ["Chicken"], "Kal dal chawal" -> ["Dal Chawal"]), return the dish name(s).
2. "detectedPreferenceUpdates": Whenever the user states a LASTING food preference, dislike, allergy, dietary style, or cooking feedback:
   - e.g. "Mujhe spicy food pasand hai." -> spiceTolerance: "Spicy", addMemoryNotes: ["Likes spicy food"]
   - e.g. "Mujhe mild/kam teekha pasand hai" -> spiceTolerance: "Mild", addMemoryNotes: ["Prefers mild spice"]
   - e.g. "Main vegetarian hoon" -> dietaryPreference: "Vegetarian"
   - e.g. "Mujhe South Indian pasand hai" -> addFavouriteCuisines: ["South Indian"]
   - e.g. "Peanuts se allergy hai" -> addAllergies: ["Peanuts"]
   - e.g. "Karela pasand nahi" -> addDislikedIngredients: ["Karela"]
   - Do NOT save temporary one-off cravings ("aaj sirf light khane ka mann hai") as permanent spiceTolerance changes unless phrased as a lasting habit ("mujhe hamesha spicy pasand hai" / "spicy food pasand hai").

Always populate "updatedDiscoveryContext" with the cumulative mood, craving, recentMealNote, timeAvailable, shoppingPreference so state survives page refreshes. (Server controls activeBudget = ${effectiveBudget === null ? 'null' : `₹${effectiveBudget}`}.)
`.trim();

      const recentHistory = history
        .filter((h) => h && typeof h.content === 'string' && h.content.trim().length > 0)
        .slice(-14)
        .map((h) => ({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.content.trim() }],
        }));

      const ai = getAiClient();
      const response = await generateContentWithFallback((model) =>
        ai.models.generateContent({
          model,
          contents: [
            ...recentHistory,
            { role: 'user', parts: [{ text: message }] },
          ],
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                intentMode: {
                  type: Type.STRING,
                  enum: [
                    'INVENTORY_UPDATE',
                    'FOOD_DISCOVERY',
                    'DISH_DISCOVERY',
                    'RECIPE_SELECTED',
                    'GENERAL_CHAT',
                  ],
                },
                selectedDishName: {
                  type: Type.STRING,
                },
                updatedDiscoveryContext: {
                  type: Type.OBJECT,
                  properties: {
                    mood: { type: Type.STRING },
                    craving: { type: Type.STRING },
                    recentMealNote: { type: Type.STRING },
                    timeAvailable: { type: Type.STRING },
                    shoppingPreference: { type: Type.STRING },
                    activeBudget: { type: Type.NUMBER },
                  },
                },
                reply: {
                  type: Type.STRING,
                  description: 'Natural, humanised conversational response as the custom food buddy.',
                },
                inventoryActions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      action: {
                        type: Type.STRING,
                        enum: [
                          'ADD_INGREDIENT',
                          'UPDATE_QUANTITY',
                          'REMOVE_INGREDIENT',
                          'MARK_UNAVAILABLE',
                          'CONSUME_INGREDIENT',
                          'RESTOCK_INGREDIENT',
                          'QUERY_INVENTORY',
                          'NO_INVENTORY_ACTION',
                        ],
                      },
                      ingredient: { type: Type.STRING },
                      canonicalName: { type: Type.STRING },
                      quantity: { type: Type.NUMBER },
                      unit: { type: Type.STRING },
                      category: {
                        type: Type.STRING,
                        enum: [
                          'Vegetables',
                          'Fruits',
                          'Grains',
                          'Rice',
                          'Pulses',
                          'Dairy',
                          'Eggs and meat',
                          'Spices',
                          'Sauces',
                          'Other',
                        ],
                      },
                      confidence: { type: Type.NUMBER },
                      needsClarification: { type: Type.BOOLEAN },
                      clarificationQuestion: { type: Type.STRING },
                      isPurchase: { type: Type.BOOLEAN },
                    },
                    required: ['action', 'ingredient', 'confidence'],
                  },
                },
                includeBudgetPlan: {
                  type: Type.BOOLEAN,
                },
                budgetPlan: {
                  type: Type.OBJECT,
                  properties: {
                    budgetLimit: { type: Type.NUMBER },
                    isWithinBudget: { type: Type.BOOLEAN },
                    availableUsed: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    itemsToBuy: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          name: { type: Type.STRING },
                          quantity: { type: Type.STRING },
                          estimatedPriceRange: { type: Type.STRING },
                          estimatedCostInr: { type: Type.NUMBER },
                          isEssential: { type: Type.BOOLEAN },
                          reuseNote: { type: Type.STRING },
                        },
                        required: ['name', 'quantity', 'estimatedPriceRange', 'estimatedCostInr', 'isEssential'],
                      },
                    },
                    totalEstimatedCost: { type: Type.NUMBER },
                    remainingBudget: { type: Type.NUMBER },
                    disclaimer: { type: Type.STRING },
                  },
                  required: [
                    'budgetLimit',
                    'isWithinBudget',
                    'availableUsed',
                    'itemsToBuy',
                    'totalEstimatedCost',
                    'remainingBudget',
                    'disclaimer',
                  ],
                },
                suggestedDishes: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      dishName: { type: Type.STRING },
                      cuisine: { type: Type.STRING },
                      shortPitch: { type: Type.STRING },
                      prepCookTime: { type: Type.STRING },
                      servings: { type: Type.INTEGER },
                      estimatedExtraCostInr: { type: Type.NUMBER },
                      usesExistingOnly: { type: Type.BOOLEAN },
                      matchReason: { type: Type.STRING },
                      imageCategory: {
                        type: Type.STRING,
                        enum: ['north_indian', 'street_food', 'indo_chinese', 'kitchen'],
                      },
                      requiredIngredients: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            name: { type: Type.STRING },
                            quantity: { type: Type.STRING },
                            numericQuantity: { type: Type.NUMBER },
                            unit: { type: Type.STRING },
                            isEssential: { type: Type.BOOLEAN },
                          },
                          required: ['name', 'quantity', 'numericQuantity', 'unit', 'isEssential'],
                        },
                      },
                    },
                    required: [
                      'dishName',
                      'cuisine',
                      'shortPitch',
                      'prepCookTime',
                      'servings',
                      'estimatedExtraCostInr',
                      'usesExistingOnly',
                      'matchReason',
                      'imageCategory',
                      'requiredIngredients',
                    ],
                  },
                },
                detectedMealsEatenRecently: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                detectedPreferenceUpdates: {
                  type: Type.OBJECT,
                  properties: {
                    spiceTolerance: {
                      type: Type.STRING,
                      enum: ['Mild', 'Medium', 'Spicy', 'Extra Spicy'],
                    },
                    dietaryPreference: {
                      type: Type.STRING,
                      enum: ['Vegetarian', 'Non-Vegetarian', 'Eggetarian', 'Vegan'],
                    },
                    addFavouriteCuisines: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    addAllergies: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    addDislikedIngredients: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    addMemoryNotes: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                },
              },
              required: [
                'intentMode',
                'reply',
                'inventoryActions',
                'includeBudgetPlan',
                'suggestedDishes',
                'detectedMealsEatenRecently',
              ],
            },
          },
        }),
      );

      interface RawInventoryAction {
        action: string;
        ingredient: string;
        canonicalName?: string;
        quantity?: number;
        unit?: string;
        category?: string;
        confidence: number;
        needsClarification?: boolean;
        clarificationQuestion?: string;
        isPurchase?: boolean;
      }

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText) as {
        intentMode: ChatResponseMode;
        selectedDishName?: string;
        updatedDiscoveryContext?: DiscoveryContextInput;
        reply: string;
        inventoryActions: RawInventoryAction[];
        includeBudgetPlan: boolean;
        budgetPlan?: unknown;
        suggestedDishes: SuggestedDishInput[];
        detectedMealsEatenRecently: string[];
        detectedPreferenceUpdates?: {
          spiceTolerance?: string;
          dietaryPreference?: string;
          addFavouriteCuisines?: string[];
          addAllergies?: string[];
          addDislikedIngredients?: string[];
          addMemoryNotes?: string[];
        };
      };

      const mergedInventoryActions: RawInventoryAction[] = Array.isArray(parsed.inventoryActions)
        ? [...parsed.inventoryActions]
        : [];

      for (const claim of homeAvailableClaims) {
        const alreadyPresent = mergedInventoryActions.some(
          (a) =>
            (a.canonicalName || normalizeIngredientMeta(a.ingredient).canonicalName).toLowerCase() ===
              claim.canonicalName.toLowerCase() &&
            INVENTORY_MUTATION_ACTIONS.has(a.action),
        );
        if (!alreadyPresent) {
          const existsInInv = inventory.some(
            (i) =>
              (i.canonicalName || normalizeIngredientMeta(i.name).canonicalName).toLowerCase() ===
              claim.canonicalName.toLowerCase(),
          );
          mergedInventoryActions.push({
            action: existsInInv ? 'RESTOCK_INGREDIENT' : 'ADD_INGREDIENT',
            ingredient: claim.displayName,
            canonicalName: claim.canonicalName,
            quantity: claim.quantity,
            unit: claim.unit,
            category: normalizeIngredientMeta(claim.displayName).category,
            confidence: 0.98,
            needsClarification: false,
            isPurchase: false,
          });
        } else {
          for (const a of mergedInventoryActions) {
            if (
              (a.canonicalName || normalizeIngredientMeta(a.ingredient).canonicalName).toLowerCase() ===
              claim.canonicalName.toLowerCase()
            ) {
              a.needsClarification = false;
              if (!a.quantity || a.quantity <= 0) {
                a.quantity = claim.quantity;
                a.unit = claim.unit;
              }
            }
          }
        }
      }
      parsed.inventoryActions = mergedInventoryActions;

      const hasInventoryMutation = mergedInventoryActions.some((a) =>
        INVENTORY_MUTATION_ACTIONS.has(a.action),
      );
      const hasIncomingAdd = mergedInventoryActions.some(
        (a) => a.action === 'ADD_INGREDIENT' || a.action === 'RESTOCK_INGREDIENT',
      );
      const explicitlyAskingToCook = /\b(kya\s*khayein|kya\s*banau|kya\s*banayein|suggest|options?\s*bata|dish|recipe|bana|sasta|andar)\b/i.test(
        message,
      );
      const isNegotiatingInFlow =
        (conversationState === 'DISH_DISCOVERY' || conversationState === 'RECIPE_SELECTED') &&
        (homeAvailableClaims.length > 0 || budgetIntent.action !== 'NONE');

      let enforcedMode: ChatResponseMode = parsed.intentMode || 'GENERAL_CHAT';
      if (isNegotiatingInFlow) {
        enforcedMode = conversationState === 'RECIPE_SELECTED' ? 'RECIPE_SELECTED' : 'DISH_DISCOVERY';
      } else if (hasInventoryMutation && !explicitlyAskingToCook) {
        enforcedMode = 'INVENTORY_UPDATE';
      }

      const isRecipeNegotiationChange =
        (budgetIntent.action !== 'NONE' || homeAvailableClaims.length > 0) &&
        conversationState === 'RECIPE_SELECTED' &&
        Boolean(discoveryContext.selectedDishName) &&
        !/\b(aur\s*bata|more|different|other|naye\s*sire|rehne\s*de)\b/i.test(message);

      const resolvedSelection = isRecipeNegotiationChange
        ? discoveryContext.selectedDishName
        : enforcedMode === 'RECIPE_SELECTED' ||
            (conversationState === 'DISH_DISCOVERY' &&
              lastSuggestedDishes.length > 0 &&
              /\b(pehla|pehle|doosra|dusra|teesra|tisra|first|second|third|option\s*[123]|banate\s*hain|bana\s*de|select)\b/i.test(
                message,
              ))
          ? resolveSelectedDishFromText(message, lastSuggestedDishes, parsed.selectedDishName)
          : undefined;

      if (resolvedSelection && enforcedMode !== 'INVENTORY_UPDATE') {
        enforcedMode = 'RECIPE_SELECTED';
      }

      if (enforcedMode === 'DISH_DISCOVERY' && isKitchenEmpty && !hasIncomingAdd) {
        enforcedMode = 'FOOD_DISCOVERY';
      }

      const isFreshReset = /\b(rehne\s*de|naye\s*sire|start\s*fresh|sab\s*chhod)\b/i.test(message);
      const mergedContext: DiscoveryContextInput = isFreshReset
        ? { activeBudget: explicitDefaultBudget }
        : {
            ...discoveryContext,
            ...(parsed.updatedDiscoveryContext || {}),
            activeBudget: effectiveBudget,
          };

      let nextConversationState: ConversationState = 'IDLE';

      if (enforcedMode === 'INVENTORY_UPDATE') {
        parsed.reply = keepCrispConfirmation(parsed.reply);
        parsed.suggestedDishes = [];
        parsed.includeBudgetPlan = false;
        delete parsed.budgetPlan;
        parsed.selectedDishName = undefined;
        nextConversationState =
          conversationState === 'FOOD_DISCOVERY' || conversationState === 'DISH_DISCOVERY'
            ? conversationState
            : 'IDLE';
      } else if (enforcedMode === 'FOOD_DISCOVERY') {
        parsed.suggestedDishes = [];
        parsed.includeBudgetPlan = false;
        delete parsed.budgetPlan;
        parsed.selectedDishName = undefined;
        if (isFreshReset) {
          nextConversationState = 'IDLE';
        } else {
          mergedContext.turnsInDiscovery = (discoveryContext.turnsInDiscovery || 0) + 1;
          if (lastSuggestedDishes.length > 0) {
            mergedContext.rejectedDishes = Array.from(
              new Set([...rejectedDishes, ...lastSuggestedDishes.map((d) => d.dishName)]),
            ).slice(-15);
            delete mergedContext.lastSuggestedDishes;
          }
          nextConversationState = 'FOOD_DISCOVERY';
        }
      } else if (enforcedMode === 'DISH_DISCOVERY') {
        const rawCandidates =
          parsed.suggestedDishes && parsed.suggestedDishes.length > 0
            ? parsed.suggestedDishes
            : lastSuggestedDishes;

        const curated = rawCandidates
          .slice(0, 3)
          .map((d) =>
            enrichDishWithCostEngine(
              d,
              engineInventoryForTurn,
              effectiveBudget,
              profile.defaultServings || 2,
            ),
          );
        parsed.suggestedDishes = curated;

        if (effectiveBudget !== null && curated.length > 0) {
          const allOverBudget = curated.every((d) => d.fitsActiveBudget === false);
          if (allOverBudget) {
            const cheapest = [...curated].sort(
              (a, b) => (a.actualShoppingOutlayInr ?? 999) - (b.actualShoppingOutlayInr ?? 999),
            )[0];
            const missingLabel = (cheapest.missingIngredients || [])
              .map((m) => `${m.name} (${m.estimatedPriceRange})`)
              .join(', ');
            if (
              !/nahi\s*ho\s*pa|not\s*possible|missing|kam\s*se\s*kam|at\s*least|chahiye/i.test(
                parsed.reply,
              )
            ) {
              parsed.reply = `${parsed.reply}\n\nHonestly bhai, abhi kitchen ke hisaab se sabse sasta option bhi ~₹${cheapest.actualShoppingOutlayInr} extra mangega (${missingLabel}), toh exact ₹${effectiveBudget} mein bina extra liye nahi banega — agar oil/masale ghar mein hain toh bata de, cost turant kam ho jayegi!`;
            }
          }
        }

        const wantsShoppingTable = /\b(shopping\s*list|list\s*bata|kya\s*kharidna)\b/i.test(message);
        if (!wantsShoppingTable) {
          parsed.includeBudgetPlan = false;
          delete parsed.budgetPlan;
        }
        if (
          lastSuggestedDishes.length > 0 &&
          /\b(nahi|aur\s*bata|aur\s*dikha|more|different|other)\b/i.test(message)
        ) {
          mergedContext.rejectedDishes = Array.from(
            new Set([...rejectedDishes, ...lastSuggestedDishes.map((d) => d.dishName)]),
          ).slice(-15);
        }
        mergedContext.lastSuggestedDishes = curated;
        parsed.selectedDishName = undefined;
        nextConversationState = 'DISH_DISCOVERY';
      } else if (enforcedMode === 'RECIPE_SELECTED') {
        parsed.suggestedDishes = [];
        parsed.includeBudgetPlan = false;
        delete parsed.budgetPlan;
        parsed.selectedDishName = resolvedSelection || parsed.selectedDishName;
        mergedContext.selectedDishName = parsed.selectedDishName;
        if (lastSuggestedDishes.length > 0 && parsed.selectedDishName) {
          mergedContext.lastSuggestedDishes = lastSuggestedDishes.map((d) =>
            d.dishName.toLowerCase() === parsed.selectedDishName!.toLowerCase()
              ? enrichDishWithCostEngine(
                  d,
                  engineInventoryForTurn,
                  effectiveBudget,
                  profile.defaultServings || 2,
                )
              : d,
          );
        }
        nextConversationState = 'RECIPE_SELECTED';
      } else {
        enforcedMode = 'GENERAL_CHAT';
        parsed.suggestedDishes = [];
        parsed.includeBudgetPlan = false;
        delete parsed.budgetPlan;
        parsed.selectedDishName = undefined;
        nextConversationState = isFreshReset
          ? 'IDLE'
          : conversationState === 'IDLE'
            ? 'IDLE'
            : conversationState;
      }

      res.json({
        ...parsed,
        intentMode: enforcedMode,
        nextConversationState,
        updatedDiscoveryContext: mergedContext,
      });
    } catch (err) {
      const details = extractUpstreamErrorDetails(err);
      console.error('[/api/chat] Gemini error:', details.code, details.statusText, details.rawMessage);
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({
        error: formatted.message,
        retryable: formatted.retryable,
      });
    }
  });

  // ===========================================================================
  // 2. Personalized 20-Point Recipe Generation
  // ===========================================================================
  app.post('/api/recipe/generate', authenticateApiRequest, async (req: Request, res: Response) => {
    try {
      const {
        dishName,
        profile,
        inventory = [],
        conversationContext = '',
        servingsOverride,
        equipmentOverride,
        utensilsOverride,
        budgetOverride,
        selectedDishBlueprint,
        lockedIngredients,
      } = (req.body || {}) as {
        dishName: string;
        profile: ProfileInput;
        inventory?: InventoryInput[];
        conversationContext?: string;
        servingsOverride?: number;
        equipmentOverride?: string;
        utensilsOverride?: string;
        budgetOverride?: number | null;
        selectedDishBlueprint?: SuggestedDishInput;
        lockedIngredients?: RecipeIngredient[];
      };

      if (!dishName || !profile) {
        return res.status(400).json({ error: 'dishName and profile are required.', retryable: false });
      }

      const servings = servingsOverride || selectedDishBlueprint?.servings || profile.defaultServings || 2;
      const equipment = equipmentOverride || profile.defaultEquipment || 'Gas Stove';
      const utensils = utensilsOverride || profile.defaultUtensils || 'One Pan / Kadhai';
      const explicitDefaultBudget =
        profile.hasExplicitDefaultBudget &&
        profile.defaultBudget !== undefined &&
        profile.defaultBudget !== null
          ? profile.defaultBudget
          : null;
      const effectiveRecipeBudget =
        budgetOverride !== undefined ? budgetOverride : explicitDefaultBudget;
      const { contextBlock } = buildUserContextBlock(profile, inventory);
      const engineInventory = toEngineInventory(inventory);

      const incomingLocked: RecipeIngredient[] | undefined =
        Array.isArray(lockedIngredients) && lockedIngredients.length > 0
          ? lockedIngredients
          : Array.isArray(selectedDishBlueprint?.requiredIngredients) &&
              selectedDishBlueprint.requiredIngredients.length > 0
            ? selectedDishBlueprint.requiredIngredients
            : undefined;

      const preLockedBreakdown = incomingLocked
        ? calculateRecipeCostBreakdown(incomingLocked, engineInventory, effectiveRecipeBudget)
        : null;

      const budgetConstraintLine =
        effectiveRecipeBudget === null
          ? 'NONE (No budget limit! Do NOT impose ₹50 or ₹100 spending caps. Maximize existing kitchen ingredients first, and list any helpful extra items with approximate market cost estimates as information only.)'
          : effectiveRecipeBudget === 0
            ? '₹0 (NO SHOPPING PERMITTED — cook 100% from existing My Kitchen ingredients; do not add unnecessary paid ingredients)'
            : `₹${effectiveRecipeBudget} (STRICT limit: keep total ingredientsToPurchase within ₹${effectiveRecipeBudget}, drop optional items if needed, and maximize existing kitchen items)`;

      const lockedDirective = preLockedBreakdown
        ? `
LOCKED INGREDIENT LIST FROM RECOMMENDATION CARD (MANDATORY 1:1 CONSISTENCY):
You MUST use ONLY these exact ingredients and quantities for ${servings} servings — do NOT invent extra shopping items or alter quantities:
${preLockedBreakdown.requiredIngredients.map((i) => `- ${i.name}: ${i.quantity} (${i.isEssential ? 'Essential' : 'Optional'})`).join('\n')}
`.trim()
        : '';

      const systemInstruction = `
You are "${profile.buddyName || 'KhanaBanana'}", generating a hyper-practical, realistic Indian home-cooking recipe.

${contextBlock}

EXPLICIT RECIPE CONSTRAINTS FOR THIS GENERATION:
- Target Dish: "${dishName}"
- Exact Servings: ${servings}
- Cooking Appliance: ${equipment}
- Utensil Constraint: ${utensils}
- Additional Shopping Budget Limit: ${budgetConstraintLine}
- Recent Conversation Context: ${conversationContext || 'User selected this dish from suggestions.'}

${lockedDirective}

CRITICAL RECIPE RULES:
1. Scale EVERY ingredient quantity realistically for ${servings} Indian servings.
2. In "exactIngredients", include BOTH the human-friendly "quantity" string (e.g. "200g") AND numeric "numericQuantity" (e.g. 200) + normalized "unit" ("g", "kg", "ml", "L", "pieces", "packets", "tbsp", "tsp", "cups", "bunch") + boolean "isEssential".
3. If Utensil Constraint mentions "One Pan" or "Kadhai", design the ENTIRE workflow for ONE single pan/kadhai.
4. Appliance Instructions:
   - If Induction: Give practical wattage/power-level guidance for EVERY step (e.g., "Medium 1000W-1200W") and note in applianceGuidance that wattage and temperature response vary by induction cooktop model.
   - If Gas Stove: Give clear low, medium, high flame guidance for every step.
5. Backend will compute exact existingIngredients, ingredientsToPurchase, pack prices, and all 3 cost totals from exactIngredients vs MY KITCHEN LIVE INVENTORY so the recipe modal matches chat cards 100%.
6. Include all 20 required fields cleanly in ${profile.preferredLanguage || 'Hinglish'} clarity.
`.trim();

      const ai = getAiClient();
      const response = await generateContentWithFallback((model) =>
        ai.models.generateContent({
          model,
          contents: `Generate the complete personalized 20-point recipe for "${dishName}" for ${servings} servings.`,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                dishName: { type: Type.STRING },
                cuisine: { type: Type.STRING },
                description: { type: Type.STRING },
                servings: { type: Type.INTEGER },
                prepTime: { type: Type.STRING },
                cookTime: { type: Type.STRING },
                difficulty: { type: Type.STRING, enum: ['Easy', 'Medium', 'Challenging'] },
                spiceLevel: { type: Type.STRING, enum: ['Mild', 'Medium', 'Spicy', 'Extra Spicy'] },
                exactIngredients: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      quantity: { type: Type.STRING },
                      numericQuantity: { type: Type.NUMBER },
                      unit: { type: Type.STRING },
                      isEssential: { type: Type.BOOLEAN },
                      notes: { type: Type.STRING },
                    },
                    required: ['name', 'quantity', 'numericQuantity', 'unit'],
                  },
                },
                existingIngredients: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                ingredientsToPurchase: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      quantity: { type: Type.STRING },
                      estimatedPriceRange: { type: Type.STRING },
                      isEssential: { type: Type.BOOLEAN },
                    },
                    required: ['name', 'quantity', 'estimatedPriceRange', 'isEssential'],
                  },
                },
                estimatedPurchaseCost: { type: Type.STRING },
                requiredUtensils: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                applianceType: { type: Type.STRING, enum: ['Gas', 'Induction', 'Both'] },
                applianceGuidance: { type: Type.STRING },
                steps: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      stepNumber: { type: Type.INTEGER },
                      title: { type: Type.STRING },
                      instruction: { type: Type.STRING },
                      heatLevel: { type: Type.STRING },
                      duration: { type: Type.STRING },
                      tip: { type: Type.STRING },
                    },
                    required: ['stepNumber', 'title', 'instruction', 'heatLevel', 'duration'],
                  },
                },
                tasteEnhancers: { type: Type.ARRAY, items: { type: Type.STRING } },
                substitutions: { type: Type.ARRAY, items: { type: Type.STRING } },
                commonMistakes: { type: Type.ARRAY, items: { type: Type.STRING } },
                storageGuidance: { type: Type.STRING },
                imageCategory: {
                  type: Type.STRING,
                  enum: ['north_indian', 'street_food', 'indo_chinese', 'kitchen'],
                },
              },
              required: [
                'dishName',
                'cuisine',
                'description',
                'servings',
                'prepTime',
                'cookTime',
                'difficulty',
                'spiceLevel',
                'exactIngredients',
                'existingIngredients',
                'ingredientsToPurchase',
                'estimatedPurchaseCost',
                'requiredUtensils',
                'applianceType',
                'applianceGuidance',
                'steps',
                'tasteEnhancers',
                'substitutions',
                'commonMistakes',
                'storageGuidance',
                'imageCategory',
              ],
            },
          },
        }),
      );

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);

      const authoritativeBreakdown = preLockedBreakdown
        ? preLockedBreakdown
        : calculateRecipeCostBreakdown(
            Array.isArray(parsed.exactIngredients) ? parsed.exactIngredients : [],
            engineInventory,
            effectiveRecipeBudget,
          );

      parsed.servings = servings;
      parsed.exactIngredients = authoritativeBreakdown.requiredIngredients;
      parsed.existingIngredients = authoritativeBreakdown.availableIngredients;
      parsed.ingredientsToPurchase = authoritativeBreakdown.missingIngredients;
      parsed.estimatedPurchaseCost = authoritativeBreakdown.estimatedPurchaseCostText;
      parsed.ingredientConsumptionValueInr = authoritativeBreakdown.ingredientConsumptionValueInr;
      parsed.missingIngredientValueInr = authoritativeBreakdown.missingIngredientValueInr;
      parsed.actualShoppingOutlayInr = authoritativeBreakdown.actualShoppingOutlayInr;
      parsed.appliedBudgetLimit = effectiveRecipeBudget;

      res.json(parsed);
    } catch (err) {
      const details = extractUpstreamErrorDetails(err);
      console.error('[/api/recipe/generate] Gemini error:', details.code, details.statusText, details.rawMessage);
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({
        error: formatted.message,
        retryable: formatted.retryable,
      });
    }
  });

  // ===========================================================================
  // 3. Real-Time Cooking Mode Assistant
  // ===========================================================================
  app.post('/api/cooking/assist', authenticateApiRequest, async (req: Request, res: Response) => {
    try {
      const {
        question,
        recipe,
        currentStepIndex,
        buddyName = 'KhanaBanana',
        preferredLanguage = 'Hinglish',
      } = (req.body || {}) as {
        question: string;
        recipe: Record<string, unknown>;
        currentStepIndex: number;
        buddyName?: string;
        preferredLanguage?: string;
      };

      if (!question || !recipe) {
        return res.status(400).json({ error: 'question and recipe context are required.', retryable: false });
      }

      const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
      const currentStep = steps[currentStepIndex] ?? steps[0];

      const systemInstruction = `
You are "${buddyName}", actively standing beside the user in the kitchen during COOKING MODE!
Language style: ${preferredLanguage}.
The user is mid-cook and needs FAST, actionable, calm, corrective instructions—do NOT restart the entire recipe!

CURRENT RECIPE:
- Dish: ${recipe.dishName} (${recipe.servings} servings)
- Appliance: ${recipe.applianceType} (${recipe.applianceGuidance})
- Utensils: ${Array.isArray(recipe.requiredUtensils) ? recipe.requiredUtensils.join(', ') : ''}
- Ingredients: ${JSON.stringify(recipe.exactIngredients)}

CURRENT STEP (${currentStepIndex + 1} of ${steps.length}):
${JSON.stringify(currentStep)}

RULES:
- Respond immediately to what's happening on the stove/induction right now.
- If they ask about induction wattage, give specific practical wattage advice and remind them wattage varies slightly by model.
- Keep the response crisp, encouraging, and directly tied to Step ${currentStepIndex + 1}.
`.trim();

      const ai = getAiClient();
      const response = await generateContentWithFallback((model) =>
        ai.models.generateContent({
          model,
          contents: question,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
      );

      res.json({
        answer: response.text ?? 'Thoda heat kam kar aur paani ka chhinta maar, sab theek ho jayega!',
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({
        error: formatted.message,
        retryable: formatted.retryable,
      });
    }
  });

  return app;
}
