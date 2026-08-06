export function getSuggestionMediaUrls(
  imageUrl: string,
  previewImageUrl?: string | null
): { previewUrl: string; originalUrl: string; sharesAsset: boolean } {
  const previewUrl = previewImageUrl || imageUrl;
  return {
    previewUrl,
    originalUrl: imageUrl,
    sharesAsset: previewUrl === imageUrl,
  };
}
