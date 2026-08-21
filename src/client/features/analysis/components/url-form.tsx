import { useState } from "react";
import type { FormEvent } from "react";
import { normalizeAndValidateUrl } from "../url-validation";

export function UrlForm({
  initialValue = "",
  onSubmit,
  busy = false,
}: {
  initialValue?: string;
  onSubmit: (url: string) => void;
  busy?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const result = normalizeAndValidateUrl(value);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    onSubmit(result.url);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full">
      <label htmlFor="website-url" className="sr-only">
        Website URL
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="website-url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://your-landing-page.com"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "website-url-error" : undefined}
          disabled={busy}
          className="h-12 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 text-base text-neutral-100 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy}
          className="h-12 shrink-0 rounded-lg bg-white px-6 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Analyze Website
        </button>
      </div>
      {error && (
        <p
          id="website-url-error"
          role="alert"
          className="mt-2.5 text-left text-sm font-medium text-neutral-200"
        >
          {error}
        </p>
      )}
    </form>
  );
}
