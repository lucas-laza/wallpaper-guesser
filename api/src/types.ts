export type CoordinatesForCity = {
  city: string;
  latitude: number;
  longitude: number;
};

export type TemperatureUnit = "C" | "F";

export type SearchLocation = {
  "name": string,
  "latitude": number,
  "longitude": number
  "country": string,
  "population": number,
  "is_capital": boolean
}

export type GameStatus = "waiting" | "started" | "finished";
export type GameMode = "classic" | "timed";