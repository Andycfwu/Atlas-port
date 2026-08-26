const normalizeUrl = (value: string | undefined): string | null => {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  return trimmedValue.replace(/\/+$/, '');
};

export interface AppConfig {
  apiUrl: string | null;
}

export const appConfig: Readonly<AppConfig> = Object.freeze({
  apiUrl: normalizeUrl(process.env.EXPO_PUBLIC_API_URL),
});
