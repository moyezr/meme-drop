export const PUBLIC_ID_ALPHABET =
  "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const PUBLIC_ID_TOKEN_LENGTH = 12;

export type PublicIdPrefix = "u" | "k" | "g" | "a";
export type PublicId<Prefix extends PublicIdPrefix = PublicIdPrefix> = `${Prefix}_${string}`;
export type UserId = PublicId<"u">;
export type ApiKeyId = PublicId<"k">;
export type GenerationId = PublicId<"g">;
export type AssetId = PublicId<"a">;

const PUBLIC_ID_PATTERN = new RegExp(
  `^([ukga])_[${PUBLIC_ID_ALPHABET}]{${PUBLIC_ID_TOKEN_LENGTH}}$`,
  "u",
);

/** Validate a complete public ID, including its typed prefix, alphabet, and token length. */
export function isPublicId<Prefix extends PublicIdPrefix>(
  value: unknown,
  expectedPrefix: Prefix,
): value is PublicId<Prefix>;
export function isPublicId(value: unknown): value is PublicId;
export function isPublicId(value: unknown, expectedPrefix?: PublicIdPrefix): value is PublicId {
  if (typeof value !== "string") return false;
  const match = PUBLIC_ID_PATTERN.exec(value);
  return match !== null && (expectedPrefix === undefined || match[1] === expectedPrefix);
}
