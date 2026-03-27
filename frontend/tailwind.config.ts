import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0B0F14',
          900: '#121821',
          800: '#1A2330',
        },
        violet: {
          700: '#2A2450',
          600: '#3A2F6B',
          500: '#5A4FB2',
        },
        teal: {
          700: '#14807C',
          600: '#1AA7A1',
          500: '#2ED1C8',
        },
        text: {
          100: '#E6EDF3',
          300: '#9BA7B4',
          500: '#5C6673',
        },
        state: {
          success: '#22C55E',
          warning: '#F59E0B',
          danger: '#EF4444',
          info: '#38BDF8',
        },
        edge: {
          DEFAULT: '#1F2937',
          accent: '#1AA7A1',
        },
      },
      fontFamily: {
        sans: ['var(--font-manrope)', 'Avenir Next', 'Segoe UI', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 400ms ease-out',
        'slide-up': 'slideUp 320ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 2.2s ease-in-out infinite',
        float: 'float 4s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { transform: 'translateY(14px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        shimmer: { '0%, 100%': { opacity: '0.38' }, '50%': { opacity: '1' } },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-4px)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
