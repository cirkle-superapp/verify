/**
 * Worldwide Identity Document Training Database
 *
 * Generates realistic synthetic identity samples for:
 * - USA (driver licenses for all 50 states + passports)
 * - Europe (Germany, France, UK, Italy, Spain, Netherlands, Belgium, Portugal, Greece, Poland, Sweden, Norway, Denmark, Finland, Austria, Switzerland, Ireland, Czech Republic, Romania, Hungary)
 * - GCC (Saudi Arabia, UAE, Kuwait, Qatar, Bahrain, Oman)
 *
 * All samples are SYNTHETIC (not real people) with realistic names,
 * valid-format ID numbers, and proper field values for each country.
 */

import type { DocType } from "@/lib/verification-types";

export interface TrainingSample {
  docType: DocType;
  name: string;
  fullNameAr?: string;
  fullNameEn: string;
  nationalId?: string;
  birthDate: string;
  gender: "Male" | "Female";
  address: string;
  documentNo: string;
  expiryDate: string;
  nationality: string;
  job?: string;
  religion?: string;
  maritalStatus?: string;
  governorate?: string;
  country: string;
  countryName: string;
  countryNameNative?: string;
  language: string;
}

// ─── Seeded random for deterministic generation ────────────────────
let seed = 12345;
function rand(): number {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
}
function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)]; }
function pickN<T>(arr: T[], n: number): T[] {
  const out: T[] = [];
  const used = new Set<number>();
  while (out.length < n && used.size < arr.length) {
    const i = Math.floor(rand() * arr.length);
    if (!used.has(i)) { used.add(i); out.push(arr[i]); }
  }
  return out;
}

// ─── USA ────────────────────────────────────────────────────────────
const US_STATES = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" }, { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" }, { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" }, { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];

const US_FIRST_M = ["James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph", "Thomas", "Charles", "Christopher", "Daniel", "Matthew", "Anthony", "Donald", "Mark", "Paul", "Steven", "Andrew", "Kenneth"];
const US_FIRST_F = ["Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen", "Nancy", "Lisa", "Betty", "Helen", "Sandra", "Donna", "Carol", "Ruth", "Sharon", "Michelle"];
const US_LAST = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"];
const US_STREETS = ["Main St", "Oak Ave", "Maple Dr", "Cedar Ln", "Pine Rd", "Elm St", "Washington Blvd", "Park Ave", "Lake Dr", "Hill Rd"];

function genUSDL(): string { return String(Math.floor(10000000 + rand() * 89999999)); }
function genUSPassport(): string { return String(Math.floor(100000000 + rand() * 899999999)); }
function genUSSSN(): string { return `${Math.floor(100 + rand() * 899)}-${Math.floor(10 + rand() * 89)}-${Math.floor(1000 + rand() * 8999)}`; }

function genUSASamples(): TrainingSample[] {
  seed = 100;
  const samples: TrainingSample[] = [];
  // 50 driver licenses (one per state)
  for (let i = 0; i < 50; i++) {
    const state = US_STATES[i];
    const isMale = i % 2 === 0;
    const first = isMale ? pick(US_FIRST_M) : pick(US_FIRST_F);
    const last = pick(US_LAST);
    const birthYear = 1960 + Math.floor(rand() * 40);
    const birthMonth = 1 + Math.floor(rand() * 12);
    const birthDay = 1 + Math.floor(rand() * 28);
    samples.push({
      docType: "driver_license", country: "US", countryName: "United States", language: "en",
      name: `US-DL-${String(i + 1).padStart(2, "0")} ${state.code} ${first} ${last}`,
      fullNameEn: `${first} ${last}`, gender: isMale ? "Male" : "Female",
      birthDate: `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
      address: `${Math.floor(100 + rand() * 9999)} ${pick(US_STREETS)}, ${state.name}`,
      documentNo: genUSDL(), expiryDate: `${2025 + Math.floor(rand() * 8)}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
      nationality: "American", job: pick(["Engineer", "Teacher", "Doctor", "Accountant", "Nurse", "Manager", "Salesperson", "Technician", "Lawyer", "Chef"]),
    });
  }
  // 20 passports
  for (let i = 0; i < 20; i++) {
    const isMale = i % 2 === 0;
    const first = isMale ? pick(US_FIRST_M) : pick(US_FIRST_F);
    const last = pick(US_LAST);
    const birthYear = 1970 + Math.floor(rand() * 30);
    const birthMonth = 1 + Math.floor(rand() * 12);
    const birthDay = 1 + Math.floor(rand() * 28);
    samples.push({
      docType: "passport", country: "US", countryName: "United States", language: "en",
      name: `US-PASS-${String(i + 1).padStart(2, "0")} ${first} ${last}`,
      fullNameEn: `${first} ${last}`, gender: isMale ? "Male" : "Female",
      birthDate: `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
      address: "", documentNo: genUSPassport(),
      expiryDate: `${2026 + Math.floor(rand() * 8)}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
      nationality: "USA",
    });
  }
  return samples;
}

// ─── EUROPE ────────────────────────────────────────────────────────
interface CountryConfig {
  code: string; name: string; native?: string; lang: string;
  firstM: string[]; firstF: string[]; last: string[];
  idPattern: () => string; passportPattern: () => string;
  streets: string[]; jobs: string[];
}

const EUROPE_CONFIGS: CountryConfig[] = [
  {
    code: "DE", name: "Germany", native: "Deutschland", lang: "de",
    firstM: ["Lukas", "Felix", "Maximilian", "Jonas", "Alexander", "Paul", "Leon", "Niklas", "Tim", "Tobias"],
    firstF: ["Sophie", "Marie", "Anna", "Lena", "Emma", "Hannah", "Mia", "Lina", "Eva", "Lara"],
    last: ["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Schulz", "Hoffmann"],
    idPattern: () => `L${String(Math.floor(1000000 + rand() * 8999999))}`,
    passportPattern: () => `C${String(Math.floor(1000000 + rand() * 8999999))}`,
    streets: ["Hauptstraße", "Bahnhofstraße", "Schulstraße", "Gartenweg", "Bergstraße", "Kirchstraße"],
    jobs: ["Ingenieur", "Arzt", "Lehrer", "Anwalt", "Kaufmann", "Programmierer", "Krankenpfleger", "Buchhalter"],
  },
  {
    code: "FR", name: "France", lang: "fr",
    firstM: ["Lucas", "Hugo", "Gabriel", "Louis", "Raphaël", "Arthur", "Jules", "Adam", "Maël", "Nathan"],
    firstF: ["Emma", "Jade", "Louise", "Alice", "Chloé", "Lina", "Léa", "Manon", "Camille", "Inès"],
    last: ["Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand", "Leroy", "Moreau"],
    idPattern: () => String(Math.floor(1000000000 + rand() * 8999999999)),
    passportPattern: () => `${String.fromCharCode(65 + Math.floor(rand() * 26))}${String(Math.floor(10000000 + rand() * 89999999))}`,
    streets: ["Rue de la Paix", "Avenue des Champs-Élysées", "Rue du Faubourg", "Boulevard Saint-Germain", "Rue Lafayette"],
    jobs: ["Ingénieur", "Médecin", "Professeur", "Avocat", "Comptable", "Infirmier", "Programmeur"],
  },
  {
    code: "GB", name: "United Kingdom", lang: "en",
    firstM: ["Oliver", "George", "Harry", "Jack", "Jacob", "Noah", "Charlie", "Muhammad", "Thomas", "Oscar"],
    firstF: ["Olivia", "Amelia", "Isla", "Ava", "Mia", "Isabella", "Sophia", "Grace", "Lily", "Freya"],
    last: ["Smith", "Jones", "Williams", "Taylor", "Brown", "Davies", "Evans", "Wilson", "Thomas", "Roberts"],
    idPattern: () => `AB${Math.floor(1000000 + rand() * 8999999)}C`,
    passportPattern: () => `${String.fromCharCode(65 + Math.floor(rand() * 26))}${Math.floor(100000000 + rand() * 899999999)}`,
    streets: ["High Street", "Station Road", "Main Street", "Church Lane", "Park Road", "Victoria Street"],
    jobs: ["Engineer", "Teacher", "Doctor", "Accountant", "Nurse", "Manager", "Solicitor", "Programmer"],
  },
  {
    code: "IT", name: "Italy", native: "Italia", lang: "it",
    firstM: ["Lorenzo", "Leonardo", "Francesco", "Alessandro", "Mattia", "Gabriele", "Tommaso", "Riccardo", "Andrea", "Edoardo"],
    firstF: ["Sofia", "Giulia", "Aurora", "Beatrice", "Alice", "Ginevra", "Emma", "Giorgia", "Vittoria", "Martina"],
    last: ["Rossi", "Russo", "Ferrari", "Esposito", "Bianchi", "Romano", "Colombo", "Ricci", "Marino", "Greco"],
    idPattern: () => `AB${Math.floor(100000 + rand() * 899999)}`,
    passportPattern: () => `Y${String(Math.floor(10000000 + rand() * 89999999))}`,
    streets: ["Via Roma", "Via Garibaldi", "Via Dante", "Via Mazzini", "Corso Italia", "Via Verdi"],
    jobs: ["Ingegnere", "Medico", "Insegnante", "Avvocato", "Commercialista", "Informatico"],
  },
  {
    code: "ES", name: "Spain", native: "España", lang: "es",
    firstM: ["Hugo", "Martín", "Daniel", "Pablo", "Mateo", "Álvaro", "Adrián", "David", "Diego", "Marco"],
    firstF: ["Lucía", "Sofía", "María", "Martina", "Paula", "Daniela", "Carla", "Noa", "Emma", "Alba"],
    last: ["García", "Rodríguez", "González", "Fernández", "López", "Martínez", "Sánchez", "Pérez", "Gómez", "Martín"],
    idPattern: () => `${String.fromCharCode(65 + Math.floor(rand() * 26))}${Math.floor(10000000 + rand() * 89999999)}`,
    passportPattern: () => `${String.fromCharCode(65 + Math.floor(rand() * 26))}${Math.floor(10000000 + rand() * 89999999)}`,
    streets: ["Calle Mayor", "Gran Vía", "Avenida de la Constitución", "Calle Real", "Plaza España"],
    jobs: ["Ingeniero", "Médico", "Profesor", "Abogado", "Contable", "Enfermero", "Programador"],
  },
  {
    code: "NL", name: "Netherlands", native: "Nederland", lang: "nl",
    firstM: ["Daan", "Sem", "Lucas", "Levi", "Finn", "Bram", "Thijs", "Sven", "Jesse", "Lars"],
    firstF: ["Emma", "Julia", "Sophie", "Zoë", "Mila", "Sara", "Lotte", "Nina", "Eva", "Liv"],
    last: ["De Jong", "Jansen", "De Vries", "Van den Berg", "Van Dijk", "Bakker", "Visser", "Smit", "Meyer", "Mulder"],
    idPattern: () => `${String.fromCharCode(65 + Math.floor(rand() * 26))}${String.fromCharCode(65 + Math.floor(rand() * 26))}${String.fromCharCode(65 + Math.floor(rand() * 26))}${Math.floor(1000000 + rand() * 8999999)}`,
    passportPattern: () => `N${String(Math.floor(10000000 + rand() * 89999999))}`,
    streets: ["Keizersgracht", "Herengracht", "Prinsengracht", "Kalverstraat", "Damstraat"],
    jobs: ["Ingenieur", "Arts", "Leraar", "Advocaat", "Accountant", "Verpleegkundige", "Programmeur"],
  },
  {
    code: "BE", name: "Belgium", native: "België", lang: "nl",
    firstM: ["Lucas", "Liam", "Noah", "Finn", "Victor", "Mats", "Arthur", "Daan", "Leon", "Elias"],
    firstF: ["Emma", "Louise", "Mila", "Elise", "Lina", "Marie", "Sofia", "Alice", "Julie", "Nina"],
    last: ["Peeters", "Janssens", "Maes", "Jacobs", "Mertens", "Willems", "Claes", "Goossens", "Wouters", "De Smet"],
    idPattern: () => String(Math.floor(10000000000 + rand() * 89999999999)),
    passportPattern: () => `EB${Math.floor(1000000 + rand() * 8999999)}`,
    streets: ["Rue Neuve", "Grand-Place", "Avenue Louise", "Rue de la Loi", "Chaussée de Charleroi"],
    jobs: ["Ingénieur", "Médecin", "Professeur", "Avocat", "Comptable", "Infirmier"],
  },
  {
    code: "PT", name: "Portugal", native: "Portugal", lang: "pt",
    firstM: ["João", "Tiago", "Rui", "Diogo", "Bruno", "Pedro", "Miguel", "André", "José", "Paulo"],
    firstF: ["Maria", "Ana", "Sofia", "Beatriz", "Inês", "Mariana", "Leonor", "Matilde", "Carolina", "Margarida"],
    last: ["Silva", "Santos", "Pereira", "Oliveira", "Costa", "Rodrigues", "Martins", "Sousa", "Fernandes", "Gomes"],
    idPattern: () => String(Math.floor(100000000 + rand() * 899999999)),
    passportPattern: () => `P${Math.floor(10000000 + rand() * 89999999)}`,
    streets: ["Rua Augusta", "Avenida da Liberdade", "Rua de Santa Catarina", "Praça do Comércio"],
    jobs: ["Engenheiro", "Médico", "Professor", "Advogado", "Contabilista", "Enfermeiro"],
  },
  {
    code: "GR", name: "Greece", native: "Ελλάδα", lang: "el",
    firstM: ["Γιώργος", "Νίκος", "Γιάννης", "Κώστας", "Δημήτρης", "Πέτρος", "Παναγιώτης", "Βασίλης", "Σπύρος", "Αλέξανδρος"],
    firstF: ["Μαρία", "Ελένη", "Σοφία", "Αναστασία", "Γεωργία", "Κωνσταντίνα", "Αικατερίνη", "Ευαγγελία", "Αθανασία", "Παρασκευή"],
    last: ["Παπαδόπουλος", "Παπαδόπουλος", "Γεωργίου", "Οικονόμου", "Παπακωνσταντίνου", "Αντωνίου", "Δημητρίου", "Πavlou", "Νικολάου", "Χριστοδούλου"],
    idPattern: () => `${String.fromCharCode(65 + Math.floor(rand() * 26))}${Math.floor(1000000 + rand() * 8999999)}`,
    passportPattern: () => `${String.fromCharCode(65 + Math.floor(rand() * 26))}${String.fromCharCode(65 + Math.floor(rand() * 26))}${Math.floor(1000000 + rand() * 8999999)}`,
    streets: ["Λεωφόρος Συγγρού", "Οδός Ερμού", "Λεωφόρος Κηφισίας", "Πλατεία Συντάγματος"],
    jobs: ["Μηχανικός", "Ιατρός", "Δάσκαλος", "Δικηγόρος", "Λογιστής"],
  },
  {
    code: "PL", name: "Poland", native: "Polska", lang: "pl",
    firstM: ["Jan", "Jakub", "Piotr", "Michał", "Krzysztof", "Andrzej", "Tomasz", "Paweł", "Marcin", "Adam"],
    firstF: ["Anna", "Maria", "Katarzyna", "Małgorzata", "Agnieszka", "Barbara", "Krystyna", "Ewa", "Magdalena", "Joanna"],
    last: ["Nowak", "Kowalski", "Wiśniewski", "Wójcik", "Kowalczyk", "Kamiński", "Lewandowski", "Zieliński", "Szymański", "Woźniak"],
    idPattern: () => String(Math.floor(10000000000 + rand() * 89999999999)),
    passportPattern: () => `${String.fromCharCode(65 + Math.floor(rand() * 26))}${Math.floor(10000000 + rand() * 89999999)}`,
    streets: ["ul. Marszałkowska", "ul. Krakowskie Przedmieście", "ul. Nowy Świat", "ul. Mokotowska"],
    jobs: ["Inżynier", "Lekarz", "Nauczyciel", "Prawnik", "Księgowy", "Programista"],
  },
  {
    code: "SE", name: "Sweden", native: "Sverige", lang: "sv",
    firstM: ["Liam", "Noah", "Oliver", "William", "Lucas", "Elias", "Leo", "Oscar", "Erik", "Alexander"],
    firstF: ["Alice", "Maja", "Lilly", "Elsa", "Wilma", "Ebba", "Olivia", "Astrid", "Saga", "Freja"],
    last: ["Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Larsson", "Olsson", "Persson", "Svensson", "Gustafsson"],
    idPattern: () => `${Math.floor(10 + rand() * 89)}${Math.floor(10 + rand() * 89)}${Math.floor(10 + rand() * 89)}-${Math.floor(1000 + rand() * 8999)}`,
    passportPattern: () => `SE${Math.floor(1000000 + rand() * 8999999)}`,
    streets: ["Kungsgatan", "Drottninggatan", "Vasagatan", "Sveavägen", "Hamngatan"],
    jobs: ["Ingenjör", "Läkare", "Lärare", "Advokat", "Sjuksköterska", "Programmerare"],
  },
  {
    code: "AT", name: "Austria", native: "Österreich", lang: "de",
    firstM: ["Lukas", "David", "Florian", "Michael", "Stefan", "Markus", "Thomas", "Christian", "Andreas", "Martin"],
    firstF: ["Sarah", "Anna", "Lisa", "Julia", "Laura", "Sophie", "Katharina", "Nina", "Lena", "Marie"],
    last: ["Gruber", "Huber", "Bauer", "Wagner", "Pichler", "Steiner", "Moser", "Mayer", "Egger", "Leitner"],
    idPattern: () => String(Math.floor(10000000000 + rand() * 89999999999)),
    passportPattern: () => `P${Math.floor(1000000 + rand() * 8999999)}`,
    streets: ["Hauptstraße", "Wiener Straße", "Linzer Straße", "Salzburger Straße", "Grazer Gasse"],
    jobs: ["Ingenieur", "Arzt", "Lehrer", "Anwalt", "Buchhalter", "Programmierer"],
  },
  {
    code: "CH", name: "Switzerland", native: "Schweiz", lang: "de",
    firstM: ["Liam", "Noah", "Luca", "Leon", "Elias", "David", "Finn", "Nico", "Julian", "Samuel"],
    firstF: ["Mia", "Emma", "Sofia", "Lina", "Nina", "Lea", "Lara", "Mila", "Hanna", "Zoe"],
    last: ["Müller", "Meier", "Schmid", "Keller", "Weber", "Huber", "Meyer", "Gerber", "Steiner", "Frey"],
    idPattern: () => `CHE-${Math.floor(100000000 + rand() * 899999999)}`,
    passportPattern: () => `X${Math.floor(10000000 + rand() * 89999999)}`,
    streets: ["Bahnhofstrasse", "Hauptstrasse", "Rue du Lac", "Via Roma", "Quai du Mont-Blanc"],
    jobs: ["Ingenieur", "Arzt", "Lehrer", "Anwalt", "Buchhalter", "Informatiker"],
  },
  {
    code: "IE", name: "Ireland", native: "Éire", lang: "en",
    firstM: ["Jack", "James", "Daniel", "Sean", "Conor", "Adam", "Luke", "Michael", "Cian", "Oisin"],
    firstF: ["Emily", "Sophie", "Aoife", "Emma", "Grace", "Lucy", "Chloe", "Sarah", "Amber", "Hannah"],
    last: ["Murphy", "Kelly", "O'Sullivan", "Walsh", "Smith", "O'Brien", "Byrne", "Ryan", "O'Connor", "O'Neill"],
    idPattern: () => `PPS${Math.floor(1000000 + rand() * 8999999)}`,
    passportPattern: () => `D${Math.floor(10000000 + rand() * 89999999)}`,
    streets: ["O'Connell Street", "Grafton Street", "Henry Street", "Patrick Street", "Grafton Street Upper"],
    jobs: ["Engineer", "Doctor", "Teacher", "Solicitor", "Accountant", "Nurse", "Programmer"],
  },
  {
    code: "CZ", name: "Czech Republic", native: "Česko", lang: "cs",
    firstM: ["Jan", "Tomáš", "Jakub", "Lukáš", "Martin", "Ondřej", "Filip", "David", "Matěj", "Adam"],
    firstF: ["Eliška", "Tereza", "Viktorie", "Adéla", "Anna", "Sofie", "Rozálie", "Emma", "Julie", "Nela"],
    last: ["Novák", "Svoboda", "Novotný", "Dvořák", "Černý", "Procházka", "Kučera", "Veselý", "Horák", "Němec"],
    idPattern: () => String(Math.floor(1000000000 + rand() * 8999999999)),
    passportPattern: () => `${Math.floor(10000000 + rand() * 89999999)}`,
    streets: ["Václavské náměstí", "Karlova ulice", "Pařížská ulice", "Národní třída"],
    jobs: ["Inženýr", "Lékař", "Učitel", "Právník", "Účetní", "Programátor"],
  },
  {
    code: "RO", name: "Romania", native: "România", lang: "ro",
    firstM: ["Andrei", "Alexandru", "Ionuț", "Mihai", "Florin", "Radu", "Cristian", "Gabriel", "Vlad", "Daniel"],
    firstF: ["Maria", "Andreea", "Ioana", "Alexandra", "Elena", "Mădălina", "Gabriela", "Daniela", "Alina", "Cristina"],
    last: ["Popescu", "Pop", "Stan", "Stoica", "Ionescu", "Radu", "Dumitrescu", "Nica", "Gheorghe", "Preda"],
    idPattern: () => String(Math.floor(10000000000 + rand() * 89999999999)),
    passportPattern: () => `R${Math.floor(10000000 + rand() * 89999999)}`,
    streets: ["Calea Victoriei", "Bulevardul Magheru", "Strada Lipscani", "Bulevardul Dacia"],
    jobs: ["Inginer", "Medic", "Profesor", "Avocat", "Contabil", "Programator"],
  },
  {
    code: "HU", name: "Hungary", native: "Magyarország", lang: "hu",
    firstM: ["Bence", "Máté", "Ádám", "Dávid", "Balázs", "Gábor", "Péter", "Zoltán", "Tamás", "Krisztián"],
    firstF: ["Anna", "Nóra", "Lili", "Sára", "Júlia", "Boglárka", "Zsófia", "Emma", "Mira", "Vivien"],
    last: ["Nagy", "Kovács", "Tóth", "Szabó", "Horváth", "Varga", "Kiss", "Molnár", "Németh", "Balogh"],
    idPattern: () => String(Math.floor(10000000000 + rand() * 89999999999)),
    passportPattern: () => `H${Math.floor(10000000 + rand() * 89999999)}`,
    streets: ["Andrássy út", "Váci utca", "Rákóczi út", "Kossuth Lajos utca"],
    jobs: ["Mérnök", "Orvos", "Tanár", "Ügyvéd", "Könyvelő", "Programozó"],
  },
  {
    code: "DK", name: "Denmark", native: "Danmark", lang: "da",
    firstM: ["William", "Noah", "Victor", "Frederik", "Oscar", "Carl", "Malthe", "Emil", "Valdemar", "Elias"],
    firstF: ["Clara", "Ellen", "Frida", "Sofia", "Asta", "Karla", "Agnes", "Olivia", "Liva", "Ella"],
    last: ["Nielsen", "Jensen", "Hansen", "Pedersen", "Andersen", "Christensen", "Larsen", "Sørensen", "Rasmussen", "Jørgensen"],
    idPattern: () => `${Math.floor(10 + rand() * 89)}${Math.floor(10 + rand() * 89)}${Math.floor(10 + rand() * 89)}-${Math.floor(1000 + rand() * 8999)}`,
    passportPattern: () => `P${Math.floor(10000000 + rand() * 89999999)}`,
    streets: ["Strøget", "Vesterbrogade", "Nørrebrogade", "Østerbrogade", "Amagerbrogade"],
    jobs: ["Ingeniør", "Læge", "Lærer", "Advokat", "Bogholder", "Programmør"],
  },
  {
    code: "FI", name: "Finland", native: "Suomi", lang: "fi",
    firstM: ["Leo", "Elias", "Onni", "Oliver", "Eetu", "Leevi", "Aapo", "Daniel", "Mikael", "Matias"],
    firstF: ["Lilja", "Sofia", "Aada", "Eella", "Eevi", "Aino", "Livia", "Ellen", "Saga", "Nella"],
    last: ["Korhonen", "Virtanen", "Mäkinen", "Nieminen", "Mäkelä", "Hämäläinen", "Laine", "Heikkinen", "Koskinen", "Salminen"],
    idPattern: () => `${Math.floor(10 + rand() * 89)}${Math.floor(10 + rand() * 89)}${Math.floor(10 + rand() * 89)}-${String.fromCharCode(65 + Math.floor(rand() * 26))}${Math.floor(100 + rand() * 899)}`,
    passportPattern: () => `I${Math.floor(10000000 + rand() * 89999999)}`,
    streets: ["Mannerheimintie", "Aleksanterinkatu", "Hämeentie", "Kampinkatu"],
    jobs: ["Insinööri", "Lääkäri", "Opettaja", "Lakimies", "Tilintarkastaja", "Ohjelmoija"],
  },
  {
    code: "NO", name: "Norway", native: "Norge", lang: "no",
    firstM: ["Lucas", "Oskar", "Jakob", "Emil", "Noah", "Leo", "Filip", "Erik", "Aksel", "William"],
    firstF: ["Nora", "Emma", "Olivia", "Maja", "Ella", "Sofie", "Lea", "Ingrid", "Frida", "Selma"],
    last: ["Hansen", "Johansen", "Olsen", "Larsen", "Andersen", "Nilsen", "Pedersen", "Kristiansen", "Jensen", "Karlsen"],
    idPattern: () => `${Math.floor(10 + rand() * 89)}${Math.floor(10 + rand() * 89)}${Math.floor(10 + rand() * 89)} ${Math.floor(10000 + rand() * 89999)}`,
    passportPattern: () => `P${Math.floor(10000000 + rand() * 89999999)}`,
    streets: ["Karl Johans gate", "Storgata", "Drammensveien", "Bogstadveien"],
    jobs: ["Ingeniør", "Lege", "Lærer", "Advokat", "Regnskapsfører", "Programmerer"],
  },
];

function genEuropeSamples(): TrainingSample[] {
  const samples: TrainingSample[] = [];
  for (const cfg of EUROPE_CONFIGS) {
    seed = 200 + cfg.code.charCodeAt(0);
    // 3 national IDs per country
    for (let i = 0; i < 3; i++) {
      const isMale = i % 2 === 0;
      const first = isMale ? pick(cfg.firstM) : pick(cfg.firstF);
      const last = pick(cfg.last);
      const birthYear = 1970 + Math.floor(rand() * 35);
      const birthMonth = 1 + Math.floor(rand() * 12);
      const birthDay = 1 + Math.floor(rand() * 28);
      samples.push({
        docType: "national_id", country: cfg.code, countryName: cfg.name, countryNameNative: cfg.native, language: cfg.lang,
        name: `${cfg.code}-NID-${String(i + 1).padStart(2, "0")} ${first} ${last}`,
        fullNameEn: `${first} ${last}`, gender: isMale ? "Male" : "Female",
        nationalId: cfg.idPattern(),
        birthDate: `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
        address: `${Math.floor(1 + rand() * 999)} ${pick(cfg.streets)}`,
        documentNo: cfg.idPattern(),
        expiryDate: `${2025 + Math.floor(rand() * 8)}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
        nationality: cfg.name, job: pick(cfg.jobs),
      });
    }
    // 2 passports per country
    for (let i = 0; i < 2; i++) {
      const isMale = i % 2 === 0;
      const first = isMale ? pick(cfg.firstM) : pick(cfg.firstF);
      const last = pick(cfg.last);
      const birthYear = 1975 + Math.floor(rand() * 30);
      const birthMonth = 1 + Math.floor(rand() * 12);
      const birthDay = 1 + Math.floor(rand() * 28);
      samples.push({
        docType: "passport", country: cfg.code, countryName: cfg.name, countryNameNative: cfg.native, language: cfg.lang,
        name: `${cfg.code}-PASS-${String(i + 1).padStart(2, "0")} ${first} ${last}`,
        fullNameEn: `${first} ${last}`, gender: isMale ? "Male" : "Female",
        birthDate: `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
        address: "", documentNo: cfg.passportPattern(),
        expiryDate: `${2026 + Math.floor(rand() * 8)}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
        nationality: cfg.name,
      });
    }
  }
  return samples;
}

// ─── GCC (Gulf Cooperation Council) ────────────────────────────────
interface GCCConfig {
  code: string; name: string; native: string; lang: string;
  firstM: string[]; firstF: string[]; fatherNames: string[]; last: string[];
  idPrefix: string; idLen: number; cities: string[]; jobs: string[];
  streets: string[];
}

const GCC_CONFIGS: GCCConfig[] = [
  {
    code: "SA", name: "Saudi Arabia", native: "السعودية", lang: "ar",
    firstM: ["محمد", "عبدالله", "عبدالعزيز", "سلطان", "فهد", "ناصر", "خالد", "تركي", "بدر", "سعد"],
    firstF: ["نورة", "سارة", "ريم", "لمى", "عبير", "هند", "العنود", "مها", "دانة", "شهد"],
    fatherNames: ["عبدالله", "عبدالعزيز", "محمد", "عبدالرحمن", "سلطان", "ناصر", "فهد", "تركي", "سعود", "عبدالإله"],
    last: ["العتيبي", "القحطاني", "الغامدي", "الشهري", "الزهراني", "الحربي", "الدوسري", "المطيري", "العمري", "البقمي"],
    idPrefix: "1", idLen: 10, cities: ["الرياض", "جدة", "الدمام", "مكة", "المدينة", "الطائف", "أبها", "تبوك"],
    jobs: ["مهندس", "طبيب", "محاسب", "معلم", "محامي", "ضابط", "موظف", "تاجر", "صيدلي", "مبرمج"],
    streets: ["شارع الملك فهد", "شارع العليا", "شارع التحلية", "شارع الملك عبدالعزيز", "طريق المدينة"],
  },
  {
    code: "AE", name: "UAE", native: "الإمارات", lang: "ar",
    firstM: ["محمد", "أحمد", "سيف", "عبدالله", "خالد", "سلطان", "حمدان", "راشد", "منصور", "فهد"],
    firstF: ["عائشة", "فاطمة", "موزة", "شيخة", "لطيفة", "مريم", "سارة", "النور", "وفاء", "عبير"],
    fatherNames: ["سيف", "راشد", "حمدان", "منصور", "سلطان", "زايد", "حمد", "خليفة", "محمد", "أحمد"],
    last: ["النعيمي", "المنصوري", "الظاهري", "النقبي", "الكعبي", "الحوسني", "الشامسي", "الفلجي", "المهيري", "الكتبي"],
    idPrefix: "784", idLen: 15, cities: ["دبي", "أبوظبي", "الشارقة", "العين", "رأس الخيمة", "الفجيرة"],
    jobs: ["مهندس", "طبيب", "موظف", "تاجر", "محاسب", "محامي", "معلم", "صيدلي"],
    streets: ["شارع الشيخ زايد", "شارع الخليج", "شارع الاتحاد", "شارع السلام"],
  },
  {
    code: "KW", name: "Kuwait", native: "الكويت", lang: "ar",
    firstM: ["محمد", "أحمد", "عبدالله", "جاسم", "فهد", "يوسف", "خالد", "ناصر", "مبارك", "صباح"],
    firstF: ["فاطمة", "عائشة", "نورة", "مريم", "هيا", "دانة", "العنود", "سارة", "عبير", "منيرة"],
    fatherNames: ["جاسم", "صباح", "مبارك", "عبدالله", "أحمد", "يوسف", "علي", "ناصر", "فهد", "خالد"],
    last: ["العنزي", "الرشيدي", "العتيبي", "الحربي", "المطيري", "الدوسري", "الشمري", "العنزي", "الصباح", "الخالد"],
    idPrefix: "2", idLen: 12, cities: ["الكويت", "حولي", "الفروانية", "الجهراء", "الأحمدي"],
    jobs: ["مهندس", "طبيب", "محامي", "محاسب", "موظف", "تاجر", "معلم"],
    streets: ["شارع الخليج", "شارع عبدالله المبارك", "شارع فهد السالم", "شارع أحمد الجابر"],
  },
  {
    code: "QA", name: "Qatar", native: "قطر", lang: "ar",
    firstM: ["محمد", "عبدالله", "أحمد", "خليفة", "تميم", "جاسم", "علي", "سعود", "ناصر", "حمد"],
    firstF: ["موزة", "عائشة", "فاطمة", "نورة", "هند", "مريم", "سارة", "لطيفة", "شيخة", "العنود"],
    fatherNames: ["خليفة", "حمد", "جاسم", "تميم", "عبدالله", "أحمد", "علي", "سعود", "ناصر", "ثاني"],
    last: ["الكواري", "العطية", "المهندي", "الكبيسي", "السليطي", "النعيمي", "الهاجري", "المري", "الدوسري", "البوعينين"],
    idPrefix: "2", idLen: 11, cities: ["الدوحة", "الريان", "الوكرة", "الخور", "الدخيل"],
    jobs: ["مهندس", "طبيب", "موظف", "تاجر", "محامي", "محاسب", "معلم"],
    streets: ["شارع الخليج الغربي", "شارع الكورنيش", "شارع الجميلية", "شارع السد"],
  },
  {
    code: "BH", name: "Bahrain", native: "البحرين", lang: "ar",
    firstM: ["محمد", "أحمد", "علي", "حسن", "عبدالله", "خالد", "عيسى", "سلمان", "جابر", "يوسف"],
    firstF: ["فاطمة", "زينب", "مريم", "نورة", "سارة", "عبير", "هند", "العنود", "آية", "روان"],
    fatherNames: ["علي", "حسن", "عبدالله", "أحمد", "عيسى", "سلمان", "خالد", "جابر", "يوسف", "محمد"],
    last: ["الخليفة", "العالي", "البنعلي", "الكوهجي", "البلوشي", "الجهني", "النوشي", "الصلال", "الرمال", "الزاكي"],
    idPrefix: "", idLen: 9, cities: ["المنامة", "المحرق", "الرفاع", "الحد", "عيسى"],
    jobs: ["مهندس", "طبيب", "موظف", "تاجر", "محاسب", "معلم", "محامي"],
    streets: ["شارع الحكومة", "شارع الشيخ عيسى", "شارع البحرين", "شارع الملك فيصل"],
  },
  {
    code: "OM", name: "Oman", native: "عمان", lang: "ar",
    firstM: ["محمد", "أحمد", "سعيد", "خميس", "علي", "حسن", "عبدالله", "سالم", "ناصر", "يوسف"],
    firstF: ["فاطمة", "عائشة", "نوال", "مريم", "سارة", "عبير", "هند", "العنود", "زينب", "آمنة"],
    fatherNames: ["سعيد", "خميس", "علي", "سالم", "عبدالله", "أحمد", "ناصر", "يوسف", "حسن", "محمد"],
    last: ["البوسعيدي", "البلوشي", "الحبسي", "الكتبي", "الشحي", "النعيمي", "الزعابي", "الهتاري", "الكتبي", "المعمري"],
    idPrefix: "", idLen: 8, cities: ["مسقط", "صلالة", "نزوى", "صحار", "صور", "بركاء"],
    jobs: ["مهندس", "طبيب", "موظف", "تاجر", "محاسب", "معلم", "صياد"],
    streets: ["شارع السلطان قابوس", "شارع النهضة", "شارع الوحدة", "شارع 18 نوفمبر"],
  },
];

function genGCCSamples(): TrainingSample[] {
  const samples: TrainingSample[] = [];
  for (const cfg of GCC_CONFIGS) {
    seed = 300 + cfg.code.charCodeAt(0);
    // 4 national IDs / residence per country
    for (let i = 0; i < 4; i++) {
      const isMale = i % 2 === 0;
      const first = isMale ? pick(cfg.firstM) : pick(cfg.firstF);
      const father = pick(cfg.fatherNames);
      const grand = pick(cfg.fatherNames);
      const last = pick(cfg.last);
      const fullNameAr = `${first} ${father} ${grand} ${last}`;
      const birthYear = 1980 + Math.floor(rand() * 25);
      const birthMonth = 1 + Math.floor(rand() * 12);
      const birthDay = 1 + Math.floor(rand() * 28);
      // Generate ID with correct format
      let nationalId = cfg.idPrefix;
      const remaining = cfg.idLen - cfg.idPrefix.length;
      for (let j = 0; j < remaining; j++) nationalId += Math.floor(rand() * 10);
      samples.push({
        docType: i === 3 ? "residence" : "national_id",
        country: cfg.code, countryName: cfg.name, countryNameNative: cfg.native, language: cfg.lang,
        name: `${cfg.code}-${i === 3 ? "RES" : "NID"}-${String(i + 1).padStart(2, "0")} ${fullNameAr}`,
        fullNameAr, fullNameEn: "", gender: isMale ? "Male" : "Female",
        nationalId,
        birthDate: `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
        address: `${pick(cfg.streets)} - ${pick(cfg.cities)}`,
        documentNo: nationalId,
        expiryDate: `${2025 + Math.floor(rand() * 8)}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
        nationality: cfg.native,
        job: pick(cfg.jobs), religion: "مسلم",
        maritalStatus: i % 3 === 0 ? (isMale ? "أعزب" : "عزباء") : "متزوج",
        governorate: pick(cfg.cities),
      });
    }
    // 2 passports per country
    for (let i = 0; i < 2; i++) {
      const isMale = i % 2 === 0;
      const first = isMale ? pick(cfg.firstM) : pick(cfg.firstF);
      const father = pick(cfg.fatherNames);
      const last = pick(cfg.last);
      const fullNameAr = `${first} ${father} ${last}`;
      const birthYear = 1980 + Math.floor(rand() * 25);
      const birthMonth = 1 + Math.floor(rand() * 12);
      const birthDay = 1 + Math.floor(rand() * 28);
      samples.push({
        docType: "passport", country: cfg.code, countryName: cfg.name, countryNameNative: cfg.native, language: cfg.lang,
        name: `${cfg.code}-PASS-${String(i + 1).padStart(2, "0")} ${fullNameAr}`,
        fullNameAr, fullNameEn: "", gender: isMale ? "Male" : "Female",
        birthDate: `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
        address: "", documentNo: `${cfg.code}${Math.floor(1000000 + rand() * 8999999)}`,
        expiryDate: `${2026 + Math.floor(rand() * 6)}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
        nationality: cfg.native,
      });
    }
  }
  return samples;
}

/** Generate the full worldwide training database. */
export function generateWorldwideTrainingDatabase(): TrainingSample[] {
  return [
    ...genUSASamples(),
    ...genEuropeSamples(),
    ...genGCCSamples(),
  ];
}

/** Stats by region. */
export function getTrainingStats() {
  const all = generateWorldwideTrainingDatabase();
  return {
    total: all.length,
    usa: all.filter(s => s.country === "US").length,
    europe: all.filter(s => EUROPE_CONFIGS.some(c => c.code === s.country)).length,
    gcc: all.filter(s => GCC_CONFIGS.some(c => c.code === s.country)).length,
    byType: {
      national_id: all.filter(s => s.docType === "national_id").length,
      passport: all.filter(s => s.docType === "passport").length,
      driver_license: all.filter(s => s.docType === "driver_license").length,
      residence: all.filter(s => s.docType === "residence").length,
    },
    countries: [...new Set(all.map(s => s.country))].length,
  };
}
