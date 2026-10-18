import { useState, type InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const { t } = useTranslation('auth');
  const [visible, setVisible] = useState(false);
  const label = t(visible ? 'hidePassword' : 'showPassword');
  return (
    <div className="password-input">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="password-toggle"
        aria-label={label}
        title={label}
        aria-controls={props.id}
        disabled={props.disabled}
        onClick={() => setVisible((value) => !value)}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible ? <path d="m3 3 18 18" /> : null}
        </svg>
      </button>
    </div>
  );
}
