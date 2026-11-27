import {FontFaceProperties} from "@opendaw/lib-dom"

const library = (src: string) => `${import.meta.env.BASE_URL}${src}`

export const Fonts = {
    Rubik: <FontFaceProperties>{
        "font-family": "Rubik",
        "font-weight": 300,
        "font-style": "normal",
        "src": library("fonts/rubik-300.woff2")
    },
    RubikBold: <FontFaceProperties>{
        "font-family": "Rubik",
        "font-weight": 400,
        "font-style": "normal",
        "src": library("fonts/rubik-400.woff2")
    },
    OpenSans: <FontFaceProperties>{
        "font-family": "Open Sans",
        "font-weight": "normal",
        "font-style": "normal",
        "src": library("fonts/OpenSans-Regular.ttf")
    },
    ArchivoStudio: <FontFaceProperties>{
        "font-family": "Archivo Studio",
        "font-weight": 400,
        "font-style": "normal",
        "src": library("fonts/archivo-studio-regular.ttf")
    }
}
