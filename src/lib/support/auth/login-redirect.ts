const DEFAULT_LOGIN_DESTINATION = "/dashboard";

function hasUnsafePathCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === "\\" || codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export function getSafeLoginDestination(nextPath: string | null | undefined): string {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return DEFAULT_LOGIN_DESTINATION;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(nextPath);
  } catch {
    return DEFAULT_LOGIN_DESTINATION;
  }

  if (
    hasUnsafePathCharacters(nextPath) ||
    hasUnsafePathCharacters(decodedPath) ||
    !decodedPath.startsWith("/") ||
    decodedPath.startsWith("//")
  ) {
    return DEFAULT_LOGIN_DESTINATION;
  }

  return nextPath;
}
