// healthcareapi-assessment.mjs

import fetch from 'node-fetch';

const API_KEY = 'ak_3b1925b8197c03bf12cb20b102ea86ecded2fe064080c3ff';
const BASE_URL = 'https://assessment.ksensetech.com/api';

// Parse BP string, return null if invalid
function parseBloodPressure(bpString) {
  if (!bpString || typeof bpString !== 'string') return null;
  const parts = bpString.split('/').map(s => s.trim());
  if (parts.length !== 2) return null;
  const systolic = Number(parts[0]);
  const diastolic = Number(parts[1]);
  if (
    isNaN(systolic) || isNaN(diastolic) ||
    parts[0] === '' || parts[1] === ''
  ) return null;
  return { systolic, diastolic };
}

function bloodPressureRisk(bpString) {
  const bp = parseBloodPressure(bpString);
  if (!bp) return 0;
  const { systolic, diastolic } = bp;
  // Assign risk stages per systolic
  let systolicRisk = 0;
  if (systolic < 120) systolicRisk = 1;
  else if (systolic >= 120 && systolic <= 129) systolicRisk = 2;
  else if (systolic >= 130 && systolic <= 139) systolicRisk = 3;
  else if (systolic >= 140) systolicRisk = 4;
  // Assign risk stages per diastolic
  let diastolicRisk = 0;
  if (diastolic < 80) diastolicRisk = 1;
  else if (diastolic >= 80 && diastolic <= 89) diastolicRisk = 3;
  else if (diastolic >= 90) diastolicRisk = 4;
  // Use higher risk stage of the two
  return Math.max(systolicRisk, diastolicRisk);
}

function temperatureRisk(temp) {
  if (temp === null || temp === undefined) return 0;
  if (typeof temp === 'string') {
    temp = Number(temp.trim());
    if (isNaN(temp)) return 0;
  }
  if (temp <= 99.5) return 0;
  else if (temp >= 99.6 && temp <= 100.9) return 1;
  else if (temp >= 101) return 2;
  return 0;
}

function ageRisk(age) {
  if (age === null || age === undefined) return 0;
  if (typeof age === 'string') {
    age = Number(age.trim());
    if (isNaN(age)) return 0;
  }
  if (age < 40) return 1;
  else if (age >= 40 && age <= 65) return 1;
  else if (age > 65) return 2;
  return 0;
}

// Detect any data quality issues for a patient
function hasDataQualityIssues(patient) {
  if (!patient.blood_pressure || !parseBloodPressure(patient.blood_pressure)) return true;

  const age = patient.age;
  if (age === null || age === undefined) return true;
  if (typeof age === 'string' && isNaN(Number(age.trim()))) return true;

  const temp = patient.temperature;
  if (temp === null || temp === undefined) return true;
  if (typeof temp === 'string' && isNaN(Number(temp.trim()))) return true;

  return false;
}

async function fetchPatients(page = 1, limit = 20, retries = 5) {
  const url = `${BASE_URL}/patients?page=${page}&limit=${limit}`;
  try {
    const res = await fetch(url, { headers: { 'x-api-key': API_KEY } });
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 1000));
        return fetchPatients(page, limit, retries - 1);
      }
      throw new Error(`Failed after retries with status ${res.status}`);
    }
    const json = await res.json();
    if (!json.data || !Array.isArray(json.data)) {
      throw new Error('Invalid data format');
    }
    return json;
  } catch (error) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 1000));
      return fetchPatients(page, limit, retries - 1);
    }
    throw error;
  }
}

async function main() {
  console.log('Fetching patient data...');

  const firstPage = await fetchPatients(1, 20);
  const totalPages = firstPage.pagination?.totalPages || 1;
  let allPatients = [...firstPage.data];

  for (let p = 2; p <= totalPages; p++) {
    const pageData = await fetchPatients(p, 20);
    allPatients = allPatients.concat(pageData.data);
  }

  const highRiskPatients = new Set();
  const feverPatients = new Set();
  const dataQualityIssues = new Set();

  for (const patient of allPatients) {
    const patientId = patient.patient_id;

    if (hasDataQualityIssues(patient)) {
      dataQualityIssues.add(patientId);
      continue;
    }

    const bpScore = bloodPressureRisk(patient.blood_pressure);
    const tempScore = temperatureRisk(patient.temperature);
    const ageScore = ageRisk(patient.age);
    const totalRisk = bpScore + tempScore + ageScore;

    if (totalRisk >= 4) highRiskPatients.add(patientId);

    // Fever patients: temperature >= 99.6°F (exactly)
    let tempVal = patient.temperature;
    if (typeof tempVal === 'string') {
      tempVal = Number(tempVal.trim());
    }
    if (!isNaN(tempVal) && tempVal >= 99.6) {
      feverPatients.add(patientId);
    }
  }

  const results = {
    high_risk_patients: Array.from(highRiskPatients),
    fever_patients: Array.from(feverPatients),
    data_quality_issues: Array.from(dataQualityIssues),
  };

  console.log('Submitting results to API...');

  const submitRes = await fetch(`${BASE_URL}/submit-assessment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(results),
  });

  const submitJson = await submitRes.json();

  console.log('Submission response:', submitJson);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
