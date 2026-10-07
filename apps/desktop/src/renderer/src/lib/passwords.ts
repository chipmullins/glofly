/** Password rules, shown live while typing (register screen, Settings → Account). */
export const PASSWORD_RULES = [
  {
    id: 'length',
    label: 'At least 8 characters',
    test: (p: string) => p.length >= 8,
    required: true
  },
  { id: 'number', label: 'One number', test: (p: string) => /[0-9]/.test(p), required: true },
  { id: 'letter', label: 'One letter', test: (p: string) => /\p{L}/u.test(p), required: true },
  {
    id: 'symbol',
    label: 'One symbol (!@#$)',
    test: (p: string) => /[^\p{L}\p{N}\s]/u.test(p),
    required: false
  }
]

export const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong']

/** 0 (empty) to 4 (strong): how many of the rules the password meets. */
export const strengthOf = (password: string): number =>
  password ? PASSWORD_RULES.filter((r) => r.test(password)).length : 0

/** The first required rule a password doesn't meet yet, if any. */
export const missingRule = (password: string): string | null =>
  PASSWORD_RULES.find((r) => r.required && !r.test(password))?.label ?? null
