'use client';

import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  btnPrimaryClass,
  fieldClass,
} from '@/components/Protected/admin/pages/ticketing/ticketingUi';
import { resetOrgMemberPassword, type OrgMember } from '@/services/members';
import {
  PASSWORD_STRENGTH_MESSAGE,
  passwordMeetsStrengthRules,
} from '@/lib/passwordPolicy';

type Props = {
  member: OrgMember;
  onClose: () => void;
};

export default function ResetStaffPasswordModal({ member, onClose }: Props) {
  const { addToast } = useToast();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sendEmail, setSendEmail] = useState(true);

  const mutation = useMutation({
    mutationFn: () => {
      const pwd = password;
      if (!passwordMeetsStrengthRules(pwd)) {
        throw new Error(PASSWORD_STRENGTH_MESSAGE);
      }
      if (pwd !== confirmPassword) {
        throw new Error('Password confirmation does not match');
      }
      return resetOrgMemberPassword(member.userId, {
        password: pwd,
        confirmPassword: confirmPassword.trim(),
        sendEmail,
      });
    },
    onSuccess: (data) => {
      addToast(data.note || 'Password reset', 'success');
      onClose();
    },
    onError: (err: Error) =>
      addToast(err.message || 'Could not reset password', 'error'),
  });

  const email = member.user?.email ?? '—';
  const name =
    [member.user?.firstName, member.user?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim() || email;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-staff-password-title"
        className="relative w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2
              id="reset-staff-password-title"
              className="text-lg font-semibold text-stone-900"
            >
              Reset password
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Desk-assist for <span className="font-medium">{name}</span> (
              {email}). Their other sessions will be signed out.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-stone-500 hover:bg-stone-100"
          >
            Close
          </button>
        </div>

        <form
          className="space-y-3"
          onSubmit={(ev: FormEvent) => {
            ev.preventDefault();
            mutation.mutate();
          }}
        >
          <label className="block text-sm">
            <span className="text-stone-700">New password</span>
            <input
              className={fieldClass}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
            <span className="mt-1 block text-xs text-stone-500">
              At least 8 characters, with uppercase, lowercase, a number, and a
              symbol. Spaces at the start or end are not allowed.
            </span>
          </label>
          <label className="block text-sm">
            <span className="text-stone-700">Confirm password</span>
            <input
              className={fieldClass}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              className="mt-1"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
            />
            <span>
              Email temporary login details to the member (they should change
              the password after signing in).
            </span>
          </label>
          <button
            type="submit"
            className={btnPrimaryClass}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? <ButtonSpinner /> : null}
            Reset password
          </button>
        </form>
      </div>
    </div>
  );
}
