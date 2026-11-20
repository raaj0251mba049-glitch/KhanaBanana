import { useState, type FormEvent } from 'react';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { ArrowRight, ChefHat, KeyRound, Loader2, Mail, User as UserIcon } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { MEDIA_ASSETS } from '../lib/mediaAssets';
import { ensureUserProfile } from '../services/firestoreService';
import { SafeImage } from './SafeImage';

type AuthMode = 'login' | 'register' | 'reset';

function mapAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password. Please check and try again.';
    case 'auth/email-already-in-use':
      return 'This email is already registered. Try signing in instead.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters long.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in popup was closed before completing.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not enabled in Firebase Console yet. Enable it under Authentication > Sign-in method, or use Google Sign-In.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a minute and try again.';
    default:
      return err instanceof Error ? err.message : 'Authentication failed. Please try again.';
  }
}

export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await ensureUserProfile(cred.user);
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Please enter your email address.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const cred = await signInWithEmailAndPassword(auth, trimmedEmail, password);
        await ensureUserProfile(cred.user);
      } else if (mode === 'register') {
        const trimmedName = name.trim();
        if (!trimmedName) {
          setError('Please enter your name so your food buddy knows what to call you.');
          setLoading(false);
          return;
        }
        const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
        await updateProfile(cred.user, { displayName: trimmedName });
        await ensureUserProfile(cred.user, trimmedName);
      } else {
        await sendPasswordResetEmail(auth, trimmedEmail);
        setNotice('Password reset link sent! Check your inbox and spam folder.');
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#FAF8F3] flex items-stretch">
      <div className="w-full max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-12">
        {/* Left Editorial Hero Column */}
        <div className="lg:col-span-7 relative min-h-[340px] lg:min-h-screen overflow-hidden bg-[#13382D]">
          <SafeImage
            src={MEDIA_ASSETS.heroKitchen}
            alt="Indian home kitchen counter with fresh vegetables, spices, and cast-iron pan"
            className="w-full h-full object-cover"
            fallbackTitle="KhanaBanana Kitchen"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#13382D]/95 via-[#13382D]/50 to-[#13382D]/25" />

          <div className="absolute inset-0 p-8 sm:p-12 lg:p-14 flex flex-col justify-between text-white">
            <div className="flex items-center gap-3">
              <img
                src={MEDIA_ASSETS.buddyAvatar}
                alt="KhanaBanana mascot"
                referrerPolicy="no-referrer"
                className="w-11 h-11 rounded-xl object-cover border border-white/25 bg-[#FAF8F3]"
              />
              <div>
                <span className="font-display text-xl font-bold tracking-tight">KhanaBanana</span>
              </div>
            </div>

            <div className="max-w-xl">
              <p className="text-xs font-medium tracking-wide text-[#F4C430] mb-3">
                AI Food Companion · Budget-First Indian Cooking
              </p>
              <h1
                className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold leading-[1.12] mb-4"
                style={{ textWrap: 'balance' }}
              >
                Khana kya hai? Woh hum decide karenge.
              </h1>
              <p className="text-base text-white/85 leading-relaxed mb-8 max-w-lg">
                Give your food buddy whatever ingredients and rupees you have right now. Get smart,
                chatpata meal plans, zero-waste shopping lists, and live step-by-step cooking help.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-white/20 pt-6 text-sm">
                <div>
                  <p className="font-semibold text-[#F4C430]">Budget Engine</p>
                  <p className="text-white/80 text-xs mt-1">
                    Strict ₹50, ₹100, or ₹0 no-shopping meal optimisation.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-[#F4C430]">Custom Buddy</p>
                  <p className="text-white/80 text-xs mt-1">
                    Name your companion Bawarchi, Chef Babu, or anything you like.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-[#F4C430]">Live Cooking Mode</p>
                  <p className="text-white/80 text-xs mt-1">
                    Gas or induction guidance with instant mid-cook rescue tips.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Authentication Form Column */}
        <div className="lg:col-span-5 flex items-center justify-center p-6 sm:p-10 lg:p-14 bg-[#FAF8F3]">
          <div className="w-full max-w-md bg-white border border-[#E6E0D3] rounded-2xl p-7 sm:p-9">
            <div className="mb-7">
              <div className="flex items-center gap-2.5 text-[#1B4D3E] mb-2">
                <ChefHat className="w-5 h-5" />
                <span className="text-sm font-semibold">Your Personal Rasoi</span>
              </div>
              <h2 className="font-display text-2xl font-bold text-[#1A2421]">
                {mode === 'login' && 'Sign in to start cooking'}
                {mode === 'register' && 'Create your KhanaBanana account'}
                {mode === 'reset' && 'Reset your password'}
              </h2>
              <p className="text-sm text-[#576560] mt-1">
                {mode === 'login' && 'Your kitchen inventory, buddy name, and saved recipes stay synced.'}
                {mode === 'register' && 'Set up your private kitchen, food preferences, and AI companion.'}
                {mode === 'reset' && 'Enter your account email and we will send a reset link.'}
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-5 p-3.5 rounded-xl bg-[#E06D2B]/10 border border-[#E06D2B]/30 text-sm text-[#9A3412]"
              >
                {error}
              </div>
            )}

            {notice && (
              <div
                role="status"
                className="mb-5 p-3.5 rounded-xl bg-[#1B4D3E]/10 border border-[#1B4D3E]/25 text-sm text-[#1B4D3E]"
              >
                {notice}
              </div>
            )}

            {mode !== 'reset' && (
              <>
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-[#E6E0D3] bg-white hover:bg-[#F3EFE6] text-[#1A2421] text-sm font-semibold transition-colors disabled:opacity-60 cursor-pointer"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                    />
                  </svg>
                  Continue with Google
                </button>

                <div className="relative my-6 flex items-center">
                  <div className="flex-grow border-t border-[#E6E0D3]" />
                  <span className="px-3 text-xs text-[#576560]">or continue with email</span>
                  <div className="flex-grow border-t border-[#E6E0D3]" />
                </div>
              </>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label htmlFor="auth-name" className="block text-xs font-medium text-[#1A2421] mb-1.5">
                    Your Name
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 text-[#576560] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="auth-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Aarav"
                      maxLength={80}
                      required
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="auth-email" className="block text-xs font-medium text-[#1A2421] mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#576560] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
                  />
                </div>
              </div>

              {mode !== 'reset' && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="auth-password" className="block text-xs font-medium text-[#1A2421]">
                      Password
                    </label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode('reset');
                          setError(null);
                          setNotice(null);
                        }}
                        className="text-xs font-medium text-[#1B4D3E] hover:underline cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-[#576560] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="auth-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      minLength={6}
                      required
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#E6E0D3] bg-[#FAF8F3] text-sm text-[#1A2421] focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#1B4D3E] hover:bg-[#13382D] text-white text-sm font-semibold transition-colors disabled:opacity-60 cursor-pointer"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>
                      {mode === 'login' && 'Sign In'}
                      {mode === 'register' && 'Create Account'}
                      {mode === 'reset' && 'Send Reset Link'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-[#E6E0D3] text-center text-sm text-[#576560]">
              {mode === 'login' && (
                <>
                  New to KhanaBanana?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setError(null);
                      setNotice(null);
                    }}
                    className="font-semibold text-[#1B4D3E] hover:underline cursor-pointer"
                  >
                    Create an account
                  </button>
                </>
              )}
              {mode === 'register' && (
                <>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setError(null);
                      setNotice(null);
                    }}
                    className="font-semibold text-[#1B4D3E] hover:underline cursor-pointer"
                  >
                    Sign in
                  </button>
                </>
              )}
              {mode === 'reset' && (
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                    setNotice(null);
                  }}
                  className="font-semibold text-[#1B4D3E] hover:underline cursor-pointer"
                >
                  Back to sign in
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
