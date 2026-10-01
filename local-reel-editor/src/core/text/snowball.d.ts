declare module 'snowball-stemmers' {
  interface Stemmer {
    stem(word: string): string;
  }
  export function newStemmer(lang: string): Stemmer;
  export function algorithms(): string[];
}
