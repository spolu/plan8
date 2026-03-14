import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { PublisherGithub } from "@electron-forge/publisher-github";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: "plan8",
    executableName: "plan8",
    // Code signing — enable when ready:
    // osxSign: {},
    // osxNotarize: {
    //   tool: "notarytool",
    //   appleId: process.env.APPLE_ID!,
    //   appleIdPassword: process.env.APPLE_ID_PASSWORD!,
    //   teamId: process.env.APPLE_TEAM_ID!,
    // },
  },
  makers: [
    new MakerZIP({}, ["darwin"]),
    new MakerDMG(
      {
        format: "ULFO",
      },
      ["darwin"]
    ),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: "spolu",
        name: "plan8",
      },
      prerelease: false,
    }),
  ],
  hooks: {
    generateAssets: async () => {
      const { execSync } = require("child_process");
      execSync("npx tsc", { stdio: "inherit" });
    },
  },
};

export default config;
