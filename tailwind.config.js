/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./*.html', './renderer.js'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        apple: {
          blue: '#007aff',
          red: '#ff3b30',
          green: '#34c759',
          yellow: '#ffcc00',
          orange: '#ff9500',
          purple: '#af52de',
          pink: '#ff2d55',
          teal: '#5ac8fa',
          gray: {
            50: '#f5f5f7',
            100: '#e8e8ed',
            200: '#d2d2d7',
            300: '#86868b',
            400: '#6e6e73',
            500: '#1d1d1f',
          }
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'apple': '0 2px 8px rgba(0, 0, 0, 0.08)',
        'apple-lg': '0 4px 16px rgba(0, 0, 0, 0.12)',
        'apple-dark': '0 2px 8px rgba(0, 0, 0, 0.3)',
      }
    },
  },
  plugins: [],
}
