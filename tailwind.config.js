/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        apex: {
          black: "#07090D",
          ink: "#0E131B",
          orange0: "#FF7A2F",
          orange1: "#F4A261",
        },
      },
      boxShadow: {
        glow:
          "0 20px 60px rgba(0, 0, 0, 0.5), 0 18px 55px rgba(255, 122, 47, 0.22)",
      },
      backgroundImage: {
        hero:
          "radial-gradient(900px 480px at 12% 12%, rgba(255, 122, 47, 0.18), transparent 62%), radial-gradient(850px 520px at 88% 84%, rgba(244, 162, 97, 0.17), transparent 62%), linear-gradient(140deg, #07090D 0%, #0E131B 52%, #07090D 100%)",
        noise:
          'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADUlEQVQImWNgYGD4DwABBAEAffl63QAAAABJRU5ErkJggg==")',
      },
    },
  },
};
