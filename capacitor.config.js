const { CapacitorConfig } = require("@capacitor/cli");

module.exports = {
  appId: "com.smooli.app",
  appName: "Smooli",
  webDir: "dist",
  server: {
    androidScheme: "https",
    iosScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#0A0A0C",
      androidSplashResourceName: "splash",
      iosUserInterfaceStyle: "dark",
    },
  },
};
