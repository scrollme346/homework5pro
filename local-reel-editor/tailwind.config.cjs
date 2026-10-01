/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0A0A0B',
        surface: { DEFAULT: '#131315', 2: '#1A1A1D', 3: '#232327' },
        line: '#2A2A2F',
        ink: { DEFAULT: '#F4F4F5', muted: '#9A9AA3', faint: '#5E5E66' },
        accent: { DEFAULT: '#3BE37F', soft: '#3BE37F1F', ink: '#05210F' },
        warn: '#F5B84B',
        danger: '#FF6B6B',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl: '14px', '2xl': '20px', '3xl': '28px' },
      keyframes: {
        fadeUp: { '0%': { opacity: 0, transform: 'translateY(6px)' }, '100%': { opacity: 1, transform: 'none' } },
      },
      animation: { fadeUp: 'fadeUp 220ms ease-out both' },
    },
  },
  plugins: [],
};
