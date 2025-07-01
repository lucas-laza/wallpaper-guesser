import * as fs from 'fs';
const fetch = require('node-fetch');

interface ResultType {
  [code: number]: { item: ImageItem };
}

interface ApiResponse {
  batchrsp: {
    items: Array<{
      item: string;
    }>;
  };
}

interface ItemDetails {
  ad: {
    title_text: {
      tx: string;
    };
    image_fullscreen_001_landscape: {
      u: string;
    };
    copyright_text: {
      tx: string;
    };
  };
}

interface ImageItem {
  title: string;
  img: string;
  copyright: string;
  country: {
    code: string,
    text: string,
  };
  state: {
    code: string | undefined,
    text: string | undefined,
  };
}

export class Data {
  set: number;
  filename: string;

  countryData: any;

  constructor(set: number = 209567, filename: string = 'data.json') {
    this.set = set;
    this.filename = filename;

    this.loadCountryData();
  }

  loadCountryData() {
    const countryPath = process.env.NODE_ENV === 'production' 
      ? '/app/countries.json'
      : './countries.json';
    
    const countryDataRaw = fs.readFileSync(countryPath, 'utf8');
    this.countryData = JSON.parse(countryDataRaw);
  }

  getCountryOrStateDetails(title: string): { country: any, state: any | undefined } {
    for (const country of this.countryData) {
      if (title.includes(country.name)) {        
        const foundState = country.states.find((state: { code: string, name: string }) => title.includes(state.name));
        
        return {
          country: { code: country.code3, text: country.name },
          state: foundState ? { code: foundState.code, text: foundState.name } : undefined
        };
      }
    }
    return { country: undefined, state: undefined };
  }

  async fetchImage(set: number = 209567): Promise<any> {
    try {
      const response = await fetch(`https://arc.msn.com/v3/Delivery/Placement?pid=${set}&fmt=json&rafb=0&ua=WindowsShellClient%2F0&cdm=1&disphorzres=9999&dispvertres=9999&lo=80217&pl=en-US&lc=en-US&ctry=us&time=2020-12-31T23:59:59Z`);

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json() as ApiResponse;

      let result: ResultType = {};

      data.batchrsp.items.forEach((item: any, i: number) => {
        const fitem: ItemDetails = JSON.parse(item.item);
        const details = this.getCountryOrStateDetails(fitem.ad.title_text.tx);
        if (details.country) {
          result[i] = { item: {
            "title": fitem.ad.title_text.tx,
            "img": fitem.ad.image_fullscreen_001_landscape.u,
            "copyright": fitem.ad.copyright_text.tx,
            "country": details.country,
            "state": details.state
          } };
        }
      });

      await this.saveDataToFile(result);

      return result;
    } catch (error) {
      console.error("Fetch error:", error);
      throw error; 
    }
  }

  async displayFetchedImages(set: number = 209560): Promise<ResultType> {
    try {
      const response = await fetch(`https://arc.msn.com/v3/Delivery/Placement?pid=${set}&fmt=json&rafb=0&ua=WindowsShellClient%2F0&cdm=1&disphorzres=9999&dispvertres=9999&lo=80217&pl=en-US&lc=en-US&ctry=us&time=2021-08-15T21:59:59Z`);

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json() as ApiResponse;

      let result: ResultType = {};

      data.batchrsp.items.forEach((item: any, i: number) => {
          const fitem: any = JSON.parse(item.item);
          result[i] = { item: fitem };
      });
      return result;
    } catch (error) {
      console.error("Fetch error:", error);
      throw error;
    }
  }

  async callFetchImageMultipleTimes(times: number = 100): Promise<string> {
    try {
      const fetchPromises = [];
      for (let i = 0; i < times; i++) {
        fetchPromises.push(this.fetchImage());
      } 

      await Promise.all(fetchPromises);

      return "ok";
    } catch (error) {
      console.error("Error during multiple fetchImage calls:", error);
      throw error;
    }
  }

  
  async saveDataToFile(newData: ResultType): Promise<void> {
    
    let existingData: ResultType = {};
    if (fs.existsSync(this.filename)) {
      const rawData = fs.readFileSync(this.filename, 'utf8');
      existingData = JSON.parse(rawData);
    }
  
    Object.keys(newData).forEach(key => {
      const newItem: ImageItem = newData[parseInt(key)].item;
      let isDuplicate = Object.values(existingData).some(
        existingItem => existingItem.item.img === newItem.img
      );
  
      if (!isDuplicate) {
        const nextKey = Math.max(...Object.keys(existingData).map(k => parseInt(k)), 0) + 1;
        existingData[nextKey] = newData[parseInt(key)];
      }
    });
  
    // Write the updated data back to the file
    fs.writeFileSync(this.filename, JSON.stringify(existingData, null, 2), 'utf8');
  }

  async getCoordinates(item: ImageItem): Promise<{ latitude: string, longitude: string }> {
    let query = item.state.text || item.country.text; // Utilisez le nom de l'état si disponible, sinon le nom du pays
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;

    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'WallpaperGuessr-dev' } }); // Nominatim requiert un User-Agent
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();

      if (data && data.length > 0) {
        return { latitude: data[0].lat, longitude: data[0].lon };
      } else {
        throw new Error('No results found');
      }
    } catch (error) {
      console.error("Fetch error:", error);
      throw error; // Propage l'erreur
    }
  }

  async testCoords(): Promise<string> {
    const coords = await this.getCoordinates({
      "title": "Le Conquet, Brittany, France",
      "img": "https://img-prod-cms-rt-microsoft-com.akamaized.net/cms/api/am/imageFileData/RW17Xu1?ver=1a2b",
      "copyright": "© Luigi Vaccarella / SOPA / eStock Photo",
      "country": {
        "code": "FRA",
        "text": "France"
      },
      "state": {
        "code": "E",
        "text": "Brittany"
      }
    });
  
    // Assurez-vous que coords a des propriétés lat et lon avant de construire l'URL
    if (coords.latitude && coords.longitude) {
      return `https://www.google.com/maps/search/?api=1&query=${coords.latitude},${coords.longitude}`;
    } else {
      throw new Error('Coordinates not found');
    }
  }
  
}
