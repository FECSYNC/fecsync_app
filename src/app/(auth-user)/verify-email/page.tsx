"use client"
import React, { useState, useRef, useEffect, Suspense } from 'react';
import { Mail } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '../../../store/authStore';
import { useToast } from '@/contexts/toast-context';
import AuthPageSkeleton from '@/components/Public_C/auth/AuthPageSkeleton';
import { readPendingAuthReturnTo } from '@/utils/authRedirect';
import FecSyncBrandLogo, { FecSyncMark } from '@/components/brand/FecSyncBrandLogo';

// Toast notifications are now handled globally by ToastContainer

interface VerifyEmailPageProps {
  email?: string;
}

function VerifyEmailContent({ email: emailProp }: VerifyEmailPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();

  // Try multiple sources for email: auth store, URL param, or prop
  const emailFromStore = useAuthStore((state) => state.emailForVerification);
  const emailFromUrl = searchParams.get('email');
  const email = emailFromStore || emailFromUrl || emailProp || '';

  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const [verifying, setVerifying] = useState(false);
  const [resendTimer, setResendTimer] = useState(30);
  const [resending, setResending] = useState(false);
  const [verificationSuccess, setVerificationSuccess] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const clearClientAuthSnapshot = () => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('signupRole');
    localStorage.removeItem('user');
    localStorage.removeItem('auth-snapshot');
    sessionStorage.removeItem('user');
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      emailForVerification: '',
    });
  };

  // Timer for resend
  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendTimer]);

  // Focus next input on change
  const handleOtpChange = (idx: number, value: string) => {
    if (!/^[0-9]?$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[idx] = value;
    setOtp(newOtp);
    if (value && idx < 5) {
      inputRefs.current[idx + 1]?.focus();
    }
    if (!value && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    }
  };

  // Handle backspace to move focus
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    }
  };

  const goToSignIn = (verifiedEmail: string) => {
    clearClientAuthSnapshot();
    setIsRedirecting(true);
    const params = new URLSearchParams({ verified: '1' });
    if (verifiedEmail) {
      params.set('email', verifiedEmail);
    }
    const returnTo = readPendingAuthReturnTo();
    if (returnTo) {
      params.set('returnTo', returnTo);
    }
    router.push(`/signin?${params.toString()}`);
  };

  // Submit OTP
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      addToast('No email found. Please go back to sign up or login.', 'error');
      return;
    }
    setVerifying(true);
    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          otp: otp.join(''),
          email: email
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Invalid or expired OTP');
      }

      setVerificationSuccess(true);
      // Toast is shown on /signin via ?verified=1 to avoid a double message.

      // Do not auto-login — send the user to the login page.
      window.setTimeout(() => {
        goToSignIn(email);
      }, 600);
    } catch (err) {
      const error = err as Error;
      addToast(error.message || 'Failed to verify OTP', 'error');
    } finally {
      setVerifying(false);
    }
  };

  // Resend OTP
  const handleResend = async () => {
    if (!email) {
      addToast('No email found. Please go back and try again.', 'error');
      return;
    }

    setResending(true);
    try {
      const response = await fetch('/api/auth/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        addToast('Verification code resent! Check your email.', 'success');
        setResendTimer(30);
        return;
      }

      if (data?.alreadyVerified) {
        addToast('Email already verified. Please log in.', 'success');
        goToSignIn(email);
        return;
      }

      throw new Error(data.message || 'Failed to resend verification email');
    } catch (err) {
      console.error('Resend error:', err);
      const error = err as Error;
      addToast(error.message || 'Failed to resend verification email', 'error');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 sm:px-6 lg:px-8 relative pt-16">
      {/* Logo in upper left */}
      <div className="absolute top-6 left-6">
        <FecSyncBrandLogo size="sm" variant="onLight" href="/signin" />
      </div>

      {/* Large logo watermark in lower left */}
      <div className="absolute bottom-4 left-4 w-48 h-48 opacity-10 pointer-events-none select-none flex items-center justify-center">
        <FecSyncMark size={160} variant="onLight" />
      </div>

      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 rounded-lg flex items-center justify-center mb-8" style={{ backgroundColor: '#D4AF37' }}>
            <Mail className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Verify your email
          </h2>
          <div className="text-gray-600 mb-8 space-y-1">
            <p>
              <span className="text-black font-semibold">
                We sent a code to {email}.
              </span> Check your inbox or spam to verify your account, then you will be taken to login.
            </p>
          </div>


          {/* OTP Input */}
          <div className="space-y-6">
            <div className="flex justify-center gap-2 mb-2">
              {otp.map((digit, idx) => (
                <input
                  key={idx}
                  ref={el => { inputRefs.current[idx] = el; }}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleOtpChange(idx, e.target.value)}
                  onKeyDown={e => handleKeyDown(e, idx)}
                  className="w-12 h-14 text-2xl text-center border border-gray-300 rounded-lg transition-all shadow-sm text-black"
                  style={{
                    backgroundColor: '#F2F2F2',
                    outline: 'none',
                    boxShadow: 'none'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#D4AF37';
                    e.target.style.boxShadow = '0 0 0 2px rgba(212, 175, 55, 0.3)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#D1D5DB';
                    e.target.style.boxShadow = 'none';
                  }}
                  required
                  disabled={verifying || verificationSuccess}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={handleVerify}
              disabled={verifying || otp.some(d => d === '') || verificationSuccess}
              className="w-full hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 cursor-pointer"
              style={{
                backgroundColor: '#D4AF37',
                cursor: verifying || otp.some(d => d === '') || verificationSuccess ? 'not-allowed' : 'pointer'
              }}
              onFocus={(e) => {
                e.target.style.boxShadow = '0 0 0 2px rgba(212, 175, 55, 0.3)';
              }}
              onBlur={(e) => {
                e.target.style.boxShadow = 'none';
              }}
            >
              {verifying ? 'Verifying...' : verificationSuccess ? (isRedirecting ? 'Going to login...' : 'Verified!') : 'Verify & Continue to Login'}
            </button>
          </div>
          <div className="mt-6 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={handleResend}
              disabled={resendTimer > 0 || resending || verificationSuccess}
              className="text-sm text-blue-600 hover:underline disabled:text-gray-400 disabled:cursor-not-allowed cursor-pointer"
              style={{
                cursor: resendTimer > 0 || resending || verificationSuccess ? 'not-allowed' : 'pointer'
              }}
            >
              {resendTimer > 0 ? `Didn't get it? Resend code (${resendTimer}s)` : "Didn't get it? Resend code"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Wrapper component with Suspense boundary
export default function VerifyEmailPage({ email }: VerifyEmailPageProps) {
  return (
    <Suspense fallback={<AuthPageSkeleton title="Verify your email" subtitle="Loading…" />}>
      <VerifyEmailContent email={email} />
    </Suspense>
  );
}
