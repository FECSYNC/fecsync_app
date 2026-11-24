'use client';

/**
 * Plan Terms and conditions rich-text — shown on the membership agreement
 * after venue terms. Same sanitizer / budgets as other merchandising fields.
 */
import MembershipRichTextEditor from '@/components/Protected/admin/pages/memberships/MembershipRichTextEditor';
import {
  TERMS_AND_CONDITIONS_HTML_MAX,
  TERMS_AND_CONDITIONS_PLAIN_MAX,
} from '@/lib/memberships/richText';

type Props = {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export default function MembershipTermsEditor(props: Props) {
  return (
    <MembershipRichTextEditor
      value={props.value}
      onChange={props.onChange}
      disabled={props.disabled}
      placeholder={
        props.placeholder ??
        'e.g. Members must present a valid photo ID. Benefits are non-transferable…'
      }
      plainMax={TERMS_AND_CONDITIONS_PLAIN_MAX}
      htmlMax={TERMS_AND_CONDITIONS_HTML_MAX}
      hint="Copied into the membership agreement guests accept. Appears after your venue terms."
    />
  );
}
