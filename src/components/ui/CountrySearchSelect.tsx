'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { countrySelectOptions } from '@/lib/countries';

type CountrySearchSelectProps = {
  value: string;
  onChange: (country: string) => void;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  id?: string;
  required?: boolean;
};

export default function CountrySearchSelect({
  value,
  onChange,
  disabled,
  className,
  inputClassName,
  placeholder = 'Select country',
  id,
  required,
}: CountrySearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const options = useMemo(() => {
    const all = countrySelectOptions(value);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((name) => name.toLowerCase().includes(q));
  }, [value, query]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const select = (country: string) => {
    onChange(country);
    close();
    inputRef.current?.blur();
  };

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    setQuery(value);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      inputRef.current?.blur();
      return;
    }
    if (event.key === 'Enter' && open && options.length === 1) {
      event.preventDefault();
      select(options[0]);
    }
  };

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={open ? query : value}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          onFocus={openList}
          onClick={openList}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onInputKeyDown}
          onBlur={() => {
            window.setTimeout(() => {
              if (!rootRef.current?.contains(document.activeElement)) {
                close();
              }
            }, 0);
          }}
          className={clsx(
            'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 pr-9 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-50',
            inputClassName
          )}
        />
        <ChevronDown
          size={16}
          aria-hidden
          className={clsx(
            'pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 transition-transform',
            open && 'rotate-180'
          )}
        />
      </div>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg ring-1 ring-black/5"
        >
          {!query.trim() ? (
            <li role="presentation">
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select('')}
              >
                {placeholder}
              </button>
            </li>
          ) : null}
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">No countries found</li>
          ) : (
            options.map((country) => (
              <li key={country} role="option" aria-selected={country === value}>
                <button
                  type="button"
                  className={clsx(
                    'w-full px-3 py-2 text-left text-sm hover:bg-[#D4AF37]/10',
                    country === value
                      ? 'bg-[#D4AF37]/15 font-medium text-gray-900'
                      : 'text-gray-900'
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(country)}
                >
                  {country}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
