function url(val: string): string {
  if (!val) return val
  return val.startsWith('http://') || val.startsWith('https://') ? val : `https://${val}`
}

const required = [
  'RADARR_URL', 'RADARR_API_KEY',
  'SONARR_URL', 'SONARR_API_KEY',
  'PROWLARR_URL', 'PROWLARR_API_KEY',
  'QBIT_URL', 'QBIT_USERNAME', 'QBIT_PASSWORD',
]
const missing = required.filter(k => !process.env[k])
if (missing.length > 0) {
  process.stderr.write(`[config] missing required env vars: ${missing.join(', ')}\n`)
  process.exit(1)
}

export const share = {
  moviesRoot: process.env.MOVIES_ROOT    ?? '/media/movies',
  tvRoot:     process.env.SHOWS_ROOT     ?? '/media/tv',
  dataDir:    process.env.SHARE_DATA_DIR ?? '/app/data',
  baseUrl:    url(process.env.SHARE_BASE_URL ?? '').replace(/\/$/, ''),
  expiryDays: parseInt(process.env.SHARE_EXPIRY_DAYS ?? '7', 10),
  password:   process.env.SHARE_PASSWORD ?? '',
}

export const config = {
  radarr: {
    url:    url(process.env.RADARR_URL!),
    apiKey: process.env.RADARR_API_KEY!,
  },
  sonarr: {
    url:    url(process.env.SONARR_URL!),
    apiKey: process.env.SONARR_API_KEY!,
  },
  prowlarr: {
    url:    url(process.env.PROWLARR_URL!),
    apiKey: process.env.PROWLARR_API_KEY!,
  },
  qbit: {
    url:      url(process.env.QBIT_URL!),
    username: process.env.QBIT_USERNAME!,
    password: process.env.QBIT_PASSWORD!,
  },
  jellyfin: {
    url:    url(process.env.JELLYFIN_URL!),
    apiKey: process.env.JELLYFIN_API_KEY!,
  },
  bazarr: {
    url:    url(process.env.BAZARR_URL!),
    apiKey: process.env.BAZARR_API_KEY!,
  },
  go2rtc: {
    url: url(process.env.GO2RTC_URL!),
  },
  filebrowser: {
    url: url(process.env.FILEBROWSER_URL!),
  },
  pareekenterprises: {
    url: url(process.env.PAREEKENTERPRISES_URL!),
  },
  gradientmotion: {
    url: url(process.env.GRADIENTMOTION_URL!),
  },
  ytdlp: {
    url: url(process.env.YTDLP_URL!),
  },
  arr: {
    qualityProfileId:  parseInt(process.env.ARR_QUALITY_PROFILE_ID  ?? '1', 10) || 1,
    languageProfileId: parseInt(process.env.ARR_LANGUAGE_PROFILE_ID ?? '1', 10) || 1,
  },
  storagePath: process.env.STORAGE_PATH ?? process.env.MOVIES_ROOT ?? '/media/movies',
}
