import { ConfigContext, ExpoConfig } from 'expo/config';

// The one shared app for every agency. app.json holds the static settings; this adds the links: the azaria://
// scheme, and https links on every agency's address (<code>.<base>), which open the app when it is installed.
// Each agency host serves the verification files under /.well-known/ (the backend's IOS_APP_ID, ANDROID_PACKAGE and
// ANDROID_CERT_FINGERPRINTS must match the ids below).

const BUNDLE_ID = 'com.azariabookings.app';
const baseDomain = process.env.EXPO_PUBLIC_TENANT_BASE_DOMAIN ?? '';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'Azaria Bookings',
  slug: config.slug ?? 'frontend',
  scheme: 'azaria',
  ios: {
    ...config.ios,
    bundleIdentifier: BUNDLE_ID,
    associatedDomains: baseDomain ? [`applinks:*.${baseDomain}`] : [],
  },
  android: {
    ...config.android,
    package: BUNDLE_ID,
    intentFilters: baseDomain
      ? [
          {
            action: 'VIEW',
            autoVerify: true,
            data: [{ scheme: 'https', host: `*.${baseDomain}` }],
            category: ['BROWSABLE', 'DEFAULT'],
          },
        ]
      : [],
  },
});
