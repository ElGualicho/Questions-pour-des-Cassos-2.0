const themesByCategory = {
  "Pop culture déglinguée": {
    id: "pop",
    label: "Pop culture déglinguée",
    image: "/assets/themes/IMG_0304.JPG",
    accent: "#d9bd28",
    ink: "#101010"
  },
  "Alcool, drogues & fictions": {
    id: "tox",
    label: "Alcool, drogues & fictions",
    image: "/assets/themes/IMG_0305.JPG",
    accent: "#e62b72",
    ink: "#ffffff"
  },
  "Corps, cul & malaise poli": {
    id: "body",
    label: "Corps, cul & malaise poli",
    image: "/assets/themes/IMG_0306.JPG",
    accent: "#63ce3d",
    ink: "#101010"
  },
  "Mort, musique & destins claqués": {
    id: "death",
    label: "Mort, musique & destins claqués",
    image: "/assets/themes/IMG_0308.JPG",
    accent: "#365fd7",
    ink: "#ffffff"
  },
  "Culture générale chelou": {
    id: "weird",
    label: "Culture générale chelou",
    image: "/assets/themes/IMG_0309.JPG",
    accent: "#f2f2ec",
    ink: "#101010"
  },
  "Internet, memes & numérique": {
    id: "net",
    label: "Internet, memes & numérique",
    image: "/assets/themes/IMG_0310.JPG",
    accent: "#62cbea",
    ink: "#101010"
  }
};

const fallbackTheme = {
  id: "default",
  label: "Questions pour des Cassos",
  image: "/assets/themes/IMG_0304.JPG",
  accent: "#d9bd28",
  ink: "#101010"
};

function getThemeForCategory(category) {
  return themesByCategory[category] || fallbackTheme;
}

module.exports = {
  fallbackTheme,
  getThemeForCategory,
  themesByCategory
};
