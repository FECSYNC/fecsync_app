'use client';

/**
 * Cancellation terms rich-text — thin wrapper over shared editor budgets.
 */
import MembershipRichTextEditor from '@/components/Protected/admin/pages/memberships/MembershipRichTextEditor';
import {
  CANCELLATION_TERMS_HTML_MAX,
  CANCELLATION_TERMS_PLAIN_MAX,
} from '@/lib/memberships/richText';

type Props = {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export default function MembershipCancellationTermsEditor(props: Props) {
  return (
    <MembershipRichTextEditor
      value={props.value}
      onChange={props.onChange}
      disabled={props.disabled}
      placeholder={
        props.placeholder ??
        'e.g. Cancel any time from your profile, or email support before your renewal date…'
      }
      plainMax={CANCELLATION_TERMS_PLAIN_MAX}
      htmlMax={CANCELLATION_TERMS_HTML_MAX}
      hint="Shown at checkout and on the guest profile when they manage cancellation."
    />
  );
}
