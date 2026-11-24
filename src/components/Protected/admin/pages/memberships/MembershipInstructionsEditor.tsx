'use client';

/**
 * Plan Instructions rich-text — confirmation email / guest profile guidance.
 */
import MembershipRichTextEditor from '@/components/Protected/admin/pages/memberships/MembershipRichTextEditor';
import {
  INSTRUCTIONS_HTML_MAX,
  INSTRUCTIONS_PLAIN_MAX,
} from '@/lib/memberships/richText';

type Props = {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export default function MembershipInstructionsEditor(props: Props) {
  return (
    <MembershipRichTextEditor
      value={props.value}
      onChange={props.onChange}
      disabled={props.disabled}
      placeholder={
        props.placeholder ??
        'e.g. Bring a photo ID on your first visit. Park at Gate B…'
      }
      plainMax={INSTRUCTIONS_PLAIN_MAX}
      htmlMax={INSTRUCTIONS_HTML_MAX}
      hint="Shown in confirmation email context and on the guest’s membership profile."
    />
  );
}
