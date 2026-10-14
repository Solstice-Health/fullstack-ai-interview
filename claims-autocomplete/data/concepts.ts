// Medical concept dictionary used by the data generator and by the fake embedder.
//
// Each concept has the formal wording used in approved claims ("clinical") and the
// everyday wording writers tend to type ("lay"). Both map to the same concept, so
// the fake embedder places them close together.

export interface Concept {
  /** Concepts with the same group embed to the same direction. */
  group: string;
  /** Relative weight in the embedding (generic words count less). */
  weight: number;
  clinical: string[];
  lay: string[];
}

export type Area = 'cardio' | 'diabetes' | 'respiratory' | 'oncology' | 'neuro' | 'immunology';

export const AREAS: Area[] = ['cardio', 'diabetes', 'respiratory', 'oncology', 'neuro', 'immunology'];

type Kind = 'event' | 'measure' | 'survival' | 'response';

export interface Endpoint extends Concept {
  kind: Kind;
}

const c = (group: string, weight: number, clinical: string[], lay: string[]): Concept => ({
  group,
  weight,
  clinical,
  lay,
});
const e = (kind: Kind, group: string, clinical: string[], lay: string[]): Endpoint => ({
  kind,
  group,
  weight: 1.2,
  clinical,
  lay,
});

// ---------------------------------------------------------------------------
// Generic concepts
// ---------------------------------------------------------------------------

export const GENERIC = {
  reducePast: c('reduce', 0.5, ['reduced', 'decreased'], ['cuts', 'slashes', 'brings down']),
  reduceInf: c('reduce', 0.5, ['reduce', 'decrease'], ['cut', 'bring down']),
  improvePast: c('improve', 0.5, ['improved', 'significantly improved'], ['boosts', 'better']),
  extendPast: c('extend', 0.5, ['prolonged', 'extended'], ['adds time', 'buys time']),
  achieved: c('achieve', 0.4, ['achieved', 'attained'], ['got to', 'hit']),
  risk: c('risk', 0.5, ['risk'], ['chance', 'odds', 'likelihood']),
  placebo: c('placebo', 0.7, ['vs placebo', 'compared with placebo'], ['against a dummy pill', 'versus a sugar pill']),
  standardCare: c('standard_care', 0.7, ['vs standard of care'], ['versus usual treatment', 'over the usual approach']),
  chemo: c('chemo', 0.8, ['chemotherapy'], ['chemo']),
  onceDaily: c('once_daily', 0.9, ['once-daily', 'once daily'], ['one pill a day', 'a single tablet each day']),
  onceWeekly: c('once_weekly', 0.9, ['once-weekly', 'once weekly'], ['one shot a week', 'every seven days']),
  everyTwoWeeks: c('q2w', 0.9, ['every 2 weeks', 'Q2W'], ['twice a month', 'fortnightly']),
  wellTolerated: c('tolerability', 0.8, ['well tolerated', 'generally well tolerated'], ['easy on people', 'gentle']),
  adverseEvents: c('adverse_events', 0.6, ['adverse reactions', 'adverse events'], ['side effects', 'unwanted effects']),
  qol: c('qol', 1.0, ['health-related quality of life', 'quality-of-life scores'], ['day-to-day wellbeing', 'how people feel day to day']),
  withFood: c('food', 0.8, ['with or without food', 'regardless of meals'], ['any time of day, fed or fasting', 'no meal timing']),
  doseAdjust: c('dose_adjust', 0.9, ['dose adjustment'], ['changing the amount', 'tweaking how much']),
  rapid: c('onset', 1.0, ['rapid onset of action', 'rapid symptom relief'], ['works fast', 'quick relief']),
  week1: c('week1', 0.8, ['as early as week 1', 'from week 1'], ['within days', 'right away']),
  week12: c('week12', 0.8, ['at week 12', 'over 12 weeks'], ['within three months', 'after three months']),
  week24: c('week24', 0.8, ['at week 24', 'over 24 weeks'], ['by six months', 'after half a year']),
  week52: c('week52', 0.8, ['at week 52', 'over 52 weeks'], ['after a year', 'within one year']),
  adults: c('adults', 0.5, ['adults', 'adult patients'], ['grown-ups', 'people over 18']),
  elderly: c('elderly', 0.9, ['patients aged 65 years and older', 'elderly patients'], ['seniors', 'older folks']),
  pediatric: c('pediatric', 0.9, ['children aged 6 to 17 years', 'pediatric patients'], ['kids', 'teens and youngsters']),
} satisfies Record<string, Concept>;

export const POPULATIONS = [GENERIC.adults, GENERIC.elderly, GENERIC.pediatric];
export const TIMES = [GENERIC.week12, GENERIC.week24, GENERIC.week52];
export const COMPARATORS = [GENERIC.placebo, GENERIC.standardCare];
export const DOSING = [GENERIC.onceDaily, GENERIC.onceWeekly, GENERIC.everyTwoWeeks];

export const SIDE_EFFECTS: Concept[] = [
  c('nausea', 1.0, ['nausea'], ['feeling sick to the stomach', 'queasiness']),
  c('headache', 1.0, ['headache'], ['head pain', 'a sore head']),
  c('diarrhea', 1.0, ['diarrhea'], ['loose stools', 'upset bowels']),
  c('injection_site', 1.0, ['injection-site reactions'], ['sore spots where the shot goes', 'redness at the jab']),
  c('uri', 1.0, ['upper respiratory tract infections', 'nasopharyngitis'], ['colds', 'sniffles']),
  c('fatigue', 1.0, ['fatigue'], ['tiredness', 'feeling worn out']),
  c('dizziness', 1.0, ['dizziness'], ['lightheadedness', 'feeling woozy']),
  c('rash', 1.0, ['rash', 'pruritus'], ['itchy skin', 'skin irritation']),
];

export const CONTRAINDICATIONS: Concept[] = [
  c('hepatic', 1.2, ['severe hepatic impairment'], ['bad liver', 'liver damage']),
  c('renal', 1.2, ['severe renal impairment', 'end-stage renal disease'], ['failing kidneys', 'kidneys that barely work']),
  c('pregnancy', 1.2, ['pregnancy'], ['expecting mothers', 'women who are expecting']),
  c('angioedema', 1.2, ['a history of angioedema'], ['past facial swelling', 'previous lip and throat swelling']),
  c('hypersensitivity', 1.2, ['known hypersensitivity to any component'], ['allergic to the ingredients', 'ingredient allergies']),
  c('thyroid', 1.2, ['a personal or family history of medullary thyroid carcinoma'], ['thyroid tumors in the family', 'family thyroid tumors']),
];

// ---------------------------------------------------------------------------
// Therapeutic areas: conditions (who) and endpoints (what improved)
// ---------------------------------------------------------------------------

export const CONDITIONS: Record<Area, Concept[]> = {
  cardio: [
    c('cvd', 1.2, ['established cardiovascular disease', 'ASCVD'], ['existing heart problems', 'prior cardiac trouble']),
    c('hypertension', 1.2, ['hypertension', 'uncontrolled hypertension'], ['high blood pressure', 'raised BP']),
    c('hfref', 1.2, ['heart failure with reduced ejection fraction', 'HFrEF'], ['weak pumping', 'a struggling pump']),
    c('afib', 1.2, ['atrial fibrillation', 'nonvalvular AF'], ['irregular heartbeat', 'a fluttering pulse']),
    c('hypercholesterolemia', 1.2, ['primary hypercholesterolemia', 'HeFH'], ['high cholesterol', 'too much blood fat']),
  ],
  diabetes: [
    c('t2d', 1.2, ['type 2 diabetes', 'T2DM'], ['diabetics', 'sugar disease']),
    c('obesity', 1.2, ['obesity', 'a BMI of 30 kg/m² or greater'], ['being very overweight', 'carrying extra pounds']),
    c('ckd', 1.2, ['chronic kidney disease', 'diabetic nephropathy'], ['weak kidneys', 'kidney trouble from sugar']),
    c('t1d', 1.2, ['type 1 diabetes', 'T1DM'], ['juvenile sugar disease', 'insulin-dependent people']),
  ],
  respiratory: [
    c('asthma', 1.2, ['severe eosinophilic asthma', 'moderate-to-severe asthma'], ['bad wheezing', 'tight chests']),
    c('copd', 1.2, ['COPD', 'chronic obstructive pulmonary disease'], ["smoker's lung", 'emphysema-type breathing trouble']),
    c('ipf', 1.2, ['idiopathic pulmonary fibrosis', 'IPF'], ['scarred lungs', 'lung scarring']),
    c('cf', 1.2, ['cystic fibrosis'], ['CF kids and adults', 'salty-sweat genetic disease']),
  ],
  oncology: [
    c('nsclc', 1.2, ['metastatic non-small cell lung cancer', 'NSCLC'], ['advanced lung tumors', 'spread lung tumours']),
    c('breast', 1.2, ['HER2-positive breast cancer', 'HR+/HER2- breast cancer'], ['tumors in the chest tissue', 'mammary tumours']),
    c('melanoma', 1.2, ['unresectable melanoma', 'advanced melanoma'], ['skin tumors that spread', 'serious mole tumours']),
    c('myeloma', 1.2, ['relapsed or refractory multiple myeloma', 'RRMM'], ['bone marrow blood tumours', 'plasma cell tumors that came back']),
  ],
  neuro: [
    c('migraine', 1.2, ['episodic migraine', 'chronic migraine'], ['bad headaches', 'pounding head attacks']),
    c('mdd', 1.2, ['major depressive disorder', 'MDD'], ['low mood', 'feeling down']),
    c('epilepsy', 1.2, ['focal-onset seizures', 'partial-onset seizures'], ['fits', 'convulsions']),
    c('ms', 1.2, ['relapsing multiple sclerosis', 'RMS'], ['nerve coating damage', 'MS flare-prone folks']),
  ],
  immunology: [
    c('psoriasis', 1.2, ['moderate-to-severe plaque psoriasis'], ['scaly skin patches', 'flaky red skin']),
    c('ra', 1.2, ['rheumatoid arthritis', 'moderately to severely active RA'], ['swollen achy joints', 'joint swelling']),
    c('uc', 1.2, ['ulcerative colitis', 'moderately to severely active UC'], ['inflamed bowel', 'gut inflammation']),
    c('ad', 1.2, ['atopic dermatitis', 'moderate-to-severe AD'], ['eczema', 'itchy eczema']),
  ],
};

export const ENDPOINTS: Record<Area, Endpoint[]> = {
  cardio: [
    e('event', 'mi', ['myocardial infarction', 'nonfatal MI'], ['heart attack', 'heart attacks']),
    e('event', 'stroke', ['stroke', 'ischemic stroke'], ['brain attack', 'clot in the brain']),
    e('event', 'cv_death', ['cardiovascular death', 'CV mortality'], ['dying from heart disease', 'fatal heart events']),
    e('event', 'hf_hosp', ['hospitalization for heart failure', 'HF hospitalization'], ['ending up in the ER with a weak heart', 'trips to the ER for fluid build-up']),
    e('measure', 'ldl', ['LDL-C', 'low-density lipoprotein cholesterol'], ['bad cholesterol', 'the bad kind of blood fat']),
    e('measure', 'sbp', ['systolic blood pressure', 'SBP'], ['the top BP number', 'upper pressure reading']),
  ],
  diabetes: [
    e('measure', 'hba1c', ['HbA1c', 'glycated hemoglobin'], ['A1C', 'average sugar levels']),
    e('measure', 'weight', ['body weight'], ['pounds', 'kilos on the scale']),
    e('event', 'hypo', ['severe hypoglycemia', 'hypoglycemic events'], ['sugar crashes', 'low sugar episodes']),
    e('event', 'mace', ['major adverse cardiovascular events', 'MACE'], ['heart attacks and strokes combined', 'big heart scares']),
    e('response', 'a1c_goal', ['an HbA1c below 7%', 'glycemic target'], ['A1C goal', 'their sugar target']),
    e('event', 'egfr_decline', ['sustained eGFR decline', 'kidney function decline'], ['kidneys getting worse', 'losing kidney power']),
  ],
  respiratory: [
    e('event', 'exacerbations', ['annualized exacerbation rate', 'severe exacerbations'], ['flare-ups', 'breathing attacks']),
    e('measure', 'fev1', ['pre-bronchodilator FEV1', 'FEV1'], ['breathing capacity', 'how much air they can blow out']),
    e('measure', 'ocs', ['oral corticosteroid use', 'OCS dose'], ['steroid tablets', 'needing steroid pills']),
    e('measure', 'fvc', ['FVC decline', 'forced vital capacity decline'], ['losing breath volume', 'shrinking air volume']),
    e('response', 'symptom_control', ['asthma control', 'ACQ-5 responder status'], ['breathing easier', 'fewer wheezy days']),
  ],
  oncology: [
    e('survival', 'os', ['overall survival', 'median OS'], ['lived longer', 'life expectancy']),
    e('survival', 'pfs', ['progression-free survival', 'median PFS'], ['time before the tumour grows', 'delay before tumors grow back']),
    e('response', 'orr', ['objective response rate', 'ORR'], ['tumors shrank', 'shrinking tumours']),
    e('response', 'cr', ['complete response', 'pathologic complete response'], ['no detectable tumour', 'tumours vanished on scans']),
    e('event', 'recurrence', ['disease recurrence', 'invasive disease recurrence'], ['the cancer coming back', 'tumour return']),
  ],
  neuro: [
    e('measure', 'mmd', ['monthly migraine days', 'MMDs'], ['headache days each month', 'bad head days']),
    e('measure', 'madrs', ['MADRS total score', 'depressive symptoms'], ['sadness ratings', 'mood scores']),
    e('measure', 'seizure_freq', ['median seizure frequency', 'seizure frequency'], ['how often fits happen', 'number of convulsions']),
    e('event', 'relapses', ['annualized relapse rate', 'confirmed relapses'], ['flare-ups per year', 'MS attacks each year']),
    e('response', 'remission_neuro', ['remission', 'sustained remission'], ['feeling like themselves again', 'getting back to normal']),
  ],
  immunology: [
    e('response', 'pasi90', ['PASI 90', 'PASI 90 response'], ['nearly clear skin', 'almost spotless skin']),
    e('response', 'acr50', ['ACR50', 'ACR50 response'], ['half the joint pain', 'big drop in joint pain']),
    e('response', 'clin_remission', ['clinical remission', 'endoscopic remission'], ['no gut flares', 'calm bowels']),
    e('response', 'easi75', ['EASI-75', 'EASI-75 response'], ['much clearer eczema', 'eczema mostly gone']),
    e('measure', 'itch', ['itch NRS', 'peak pruritus NRS'], ['scratching', 'the urge to scratch']),
  ],
};

/** Every concept in the dictionary, for building lookup tables. */
export function allConcepts(): Concept[] {
  const out: Concept[] = [...Object.values(GENERIC), ...SIDE_EFFECTS, ...CONTRAINDICATIONS];
  for (const area of AREAS) out.push(...CONDITIONS[area], ...ENDPOINTS[area]);
  return out;
}

/** Words that carry no meaning on their own. */
export const STOPWORDS = new Set(
  (
    'a an and are as at be been by for from had has have in into is it its of on or per than that the their them ' +
    'these this those to vs was were which who with without within over under after before during while not no ' +
    'any all each both more most less fewer also only first one two can may might will would should do does did ' +
    'so up down out about against versus between through how what when where your our they he she we you i'
  ).split(' '),
);
