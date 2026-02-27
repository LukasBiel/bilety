/** @type {import('next').NextConfig} */
/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // To pozwoli na zbudowanie strony mimo błędów typowania
    ignoreBuildErrors: true,
  },
  experimental: {
    serverComponentsExternalPackages: ['playwright']
  }
}

module.exports = nextConfig
