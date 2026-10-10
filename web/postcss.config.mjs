/**
 * PostCSS configuration for Tailwind CSS v4.
 *
 * Tailwind v4 only needs this one plugin — there is no tailwind.config.js and no
 * `content` glob list. app/globals.css starts with `@import "tailwindcss";`.
 *
 * @type {import('postcss-load-config').Config}
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
