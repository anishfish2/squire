/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/renderer/**/*.{html,js,jsx}",  // Scan all renderer files
    "./src/**/*.{html,js,jsx}",           // Catch any other source files
    "./*.html",
    "./*.js",
  ],
  theme: {
    extend: {
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}
