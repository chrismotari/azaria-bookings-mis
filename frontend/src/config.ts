const apiUrl = process.env.EXPO_PUBLIC_API_URL;

if (!apiUrl) {
  throw new Error('EXPO_PUBLIC_API_URL is not set. Copy frontend/.env.example to frontend/.env.');
}

export const API_URL = apiUrl.replace(/\/+$/, '');
