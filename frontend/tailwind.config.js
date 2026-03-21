/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
    },
    extend: {
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
      colors: {
        dark: {
          900: '#0b0d13',
          800: '#0f1117',
          700: '#151821',
          600: '#1a1d27',
          500: '#1f2333',
          400: '#242836',
          300: '#2a2e3b',
          200: '#353a4a',
          100: '#464d63',
        },
        accent: {
          DEFAULT: '#6366f1',
          hover: '#818cf8',
          muted: '#4f46e5',
        },
        success: {
          DEFAULT: '#22c55e',
          muted: '#166534',
        },
        danger: {
          DEFAULT: '#ef4444',
          muted: '#991b1b',
        },
        warn: {
          DEFAULT: '#f59e0b',
          muted: '#92400e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
