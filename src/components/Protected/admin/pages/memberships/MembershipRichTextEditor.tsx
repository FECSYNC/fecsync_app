'use client';

/**
 * Shared membership merchandising rich-text editor (cancellation, instructions, …).
 * Bold / italic / underline / lists / link — stored as sanitized HTML.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  htmlToPlainText,
  isEmptyMembershipHtml,
  sanitizeMembershipHtml,
  toMembershipRichTextEditorHtml,
} from '@/lib/memberships/richText';

export type MembershipRichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  plainMax: number;
  htmlMax: number;
  /** Footer hint under the editor. */
  hint?: string;
};

type Cmd =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'insertUnorderedList'
  | 'insertOrderedList';

function ToolbarBtn(props: {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        props.active
          ? 'bg-[#D4AF37]/20 text-[#6b5618]'
          : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
      }`}
      onMouseDown={(e) => {
        e.preventDefault();
        props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}

export default function MembershipRichTextEditor(
  props: MembershipRichTextEditorProps
) {
  const {
    value,
    onChange,
    disabled,
    placeholder = 'Write something guests will see…',
    plainMax,
    htmlMax,
    hint = 'Bold, lists, and links are saved as safe HTML for guests.',
  } = props;

  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastEmitted = useRef<string | null>(null);
  const labelId = useId();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState<Record<string, boolean>>({});

  const plainLen = htmlToPlainText(value).length;
  const overPlain = plainLen > plainMax;
  const nearPlain = plainLen >= plainMax * 0.9;

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const next = toMembershipRichTextEditorHtml(value);
    if (
      lastEmitted.current !== null &&
      value === lastEmitted.current &&
      sanitizeMembershipHtml(el.innerHTML) === next
    ) {
      return;
    }
    if (el.innerHTML !== next) {
      el.innerHTML = next || '';
    }
    lastEmitted.current = value;
  }, [value]);

  const emitFromDom = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    let html = sanitizeMembershipHtml(el.innerHTML);
    const plain = htmlToPlainText(html);
    if (plain.length > plainMax) {
      html = sanitizeMembershipHtml(lastEmitted.current ?? '');
      el.innerHTML = html;
    }
    if (html.length > htmlMax) {
      html = sanitizeMembershipHtml(html.slice(0, htmlMax));
      el.innerHTML = html;
    }
    if (isEmptyMembershipHtml(html)) html = '';
    lastEmitted.current = html;
    onChange(html);
  }, [onChange, plainMax, htmlMax]);

  const refreshActive = useCallback(() => {
    if (typeof document === 'undefined') return;
    try {
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        insertUnorderedList: document.queryCommandState('insertUnorderedList'),
        insertOrderedList: document.queryCommandState('insertOrderedList'),
      });
    } catch {
      /* ignore */
    }
  }, []);

  function run(cmd: Cmd) {
    if (disabled) return;
    editorRef.current?.focus();
    try {
      document.execCommand(cmd, false);
    } catch {
      /* ignore */
    }
    emitFromDom();
    refreshActive();
  }

  function addLink() {
    if (disabled) return;
    editorRef.current?.focus();
    const raw = window.prompt('Link URL', 'https://');
    if (raw == null) return;
    const url = raw.trim();
    if (!url) return;
    const href =
      /^https?:\/\//i.test(url) || /^mailto:/i.test(url)
        ? url
        : `https://${url}`;
    try {
      document.execCommand('createLink', false, href);
    } catch {
      /* ignore */
    }
    emitFromDom();
  }

  function clearFormatting() {
    if (disabled) return;
    editorRef.current?.focus();
    try {
      document.execCommand('removeFormat', false);
      document.execCommand('unlink', false);
    } catch {
      /* ignore */
    }
    emitFromDom();
    refreshActive();
  }

  const showPlaceholder = isEmptyMembershipHtml(value) && !focused;

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow ${
        focused
          ? 'border-[#D4AF37] ring-2 ring-[#D4AF37]/25'
          : overPlain
            ? 'border-red-300'
            : 'border-stone-200'
      }`}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-stone-100 bg-stone-50/90 px-2 py-1.5">
        <ToolbarBtn
          label="Bold"
          title="Bold"
          active={active.bold}
          disabled={disabled}
          onClick={() => run('bold')}
        >
          <span className="font-bold">B</span>
        </ToolbarBtn>
        <ToolbarBtn
          label="Italic"
          title="Italic"
          active={active.italic}
          disabled={disabled}
          onClick={() => run('italic')}
        >
          <span className="italic">I</span>
        </ToolbarBtn>
        <ToolbarBtn
          label="Underline"
          title="Underline"
          active={active.underline}
          disabled={disabled}
          onClick={() => run('underline')}
        >
          <span className="underline">U</span>
        </ToolbarBtn>
        <span className="mx-1 h-4 w-px bg-stone-200" aria-hidden />
        <ToolbarBtn
          label="Bullet list"
          title="Bullet list"
          active={active.insertUnorderedList}
          disabled={disabled}
          onClick={() => run('insertUnorderedList')}
        >
          • List
        </ToolbarBtn>
        <ToolbarBtn
          label="Numbered list"
          title="Numbered list"
          active={active.insertOrderedList}
          disabled={disabled}
          onClick={() => run('insertOrderedList')}
        >
          1. List
        </ToolbarBtn>
        <ToolbarBtn
          label="Link"
          title="Insert link"
          disabled={disabled}
          onClick={addLink}
        >
          Link
        </ToolbarBtn>
        <ToolbarBtn
          label="Clear formatting"
          title="Clear formatting"
          disabled={disabled}
          onClick={clearFormatting}
        >
          Clear
        </ToolbarBtn>
        <span className="ml-auto pr-1">
          <span
            id={labelId}
            className={`tabular-nums text-[11px] ${
              overPlain
                ? 'font-semibold text-red-600'
                : nearPlain
                  ? 'font-medium text-amber-700'
                  : 'text-stone-400'
            }`}
          >
            {plainLen} / {plainMax}
          </span>
        </span>
      </div>

      <div className="relative">
        {showPlaceholder ? (
          <p
            className="pointer-events-none absolute left-3.5 right-3.5 top-3 text-sm text-stone-400"
            aria-hidden
          >
            {placeholder}
          </p>
        ) : null}
        <div
          ref={editorRef}
          role="textbox"
          aria-multiline
          aria-labelledby={labelId}
          aria-invalid={overPlain}
          contentEditable={!disabled}
          suppressContentEditableWarning
          className="min-h-[7.5rem] max-h-56 overflow-y-auto px-3.5 py-3 text-sm leading-relaxed text-stone-800 outline-none empty:before:content-[''] [&_a]:text-[#8a7020] [&_a]:underline [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_p]:my-1"
          onFocus={() => {
            setFocused(true);
            refreshActive();
          }}
          onBlur={() => {
            setFocused(false);
            emitFromDom();
          }}
          onInput={emitFromDom}
          onKeyUp={refreshActive}
          onMouseUp={refreshActive}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            try {
              document.execCommand('insertText', false, text);
            } catch {
              /* ignore */
            }
            emitFromDom();
          }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 bg-stone-50/60 px-3 py-2 text-[11px] text-stone-500">
        <span>{hint}</span>
        {overPlain ? (
          <span className="font-medium text-red-600">
            Shorten the text to save
          </span>
        ) : null}
      </div>
    </div>
  );
}
