/** @type {import('next').NextConfig} */
const nextConfig = {
  // Let Next transpile the workspace package on import.
  transpilePackages: ["@warden/contracts"],
};

export default nextConfig;
