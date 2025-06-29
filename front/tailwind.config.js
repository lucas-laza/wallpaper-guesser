/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'anonymous': ['Anonymous Pro', 'monospace'],
        'montserrat': ['Montserrat', 'sans-serif'],
      },
      backdropBlur: {
        'xs': '2px',
      },
      animation: {
        'nav-underline': 'nav-underline 0.2s ease-in-out',
      },
      keyframes: {
        'nav-underline': {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        }
      }
    },
  },
  plugins: [],
}