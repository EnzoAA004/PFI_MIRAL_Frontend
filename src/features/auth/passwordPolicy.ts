/**
 * Reglas de contraseña y correo de las cuentas profesionales. Son las mismas que aplica el servidor
 * (así se avisa antes de enviar, pero la decisión final es siempre del backend).
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_RULES_TEXT =
  "Mínimo 8 caracteres, con letras, números y al menos un carácter especial (por ejemplo ! ? - _ . #). No puede empezar con un número.";

/** @returns el problema en español, o `null` si la contraseña cumple. */
export function passwordProblem(value: string): string | null {
  if (value.length < PASSWORD_MIN_LENGTH) return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (value.length > PASSWORD_MAX_LENGTH) return `La contraseña no puede superar los ${PASSWORD_MAX_LENGTH} caracteres.`;
  if (/^\d/.test(value)) return "La contraseña no puede empezar con un número.";
  if (!/\p{L}/u.test(value) || !/\d/.test(value)) return "La contraseña debe combinar letras y números.";
  if (!/[^\p{L}\d\s]/u.test(value)) return "La contraseña debe incluir al menos un carácter especial (por ejemplo ! ? - _ . # $ %).";
  return null;
}

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** Cualquier dominio sirve (gmail, institucional, etc.); solo se pide un formato usuario@dominio.ext. */
export function emailProblem(value: string): string | null {
  return EMAIL_PATTERN.test(value.trim()) ? null : "El correo no tiene un formato válido (usuario@dominio.com).";
}
