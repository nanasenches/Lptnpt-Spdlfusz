import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.codextruturas.consolevoo',
  appName: 'KosmosPy',
  webDir: 'native-dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#08090c',
  },
};

export default config;
