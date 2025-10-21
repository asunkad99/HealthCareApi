import fetch from 'node-fetch';

const API_KEY = 'ak_3b1925b8197c03bf12cb20b102ea86ecded2fe064080c3ff';
const BASE_URL = 'https://assessment.ksensetech.com/api';

async function fetchPatients(page = 1, limit = 20) {
  const url = `${BASE_URL}/patients?page=${page}&limit=${limit}`;

  try {
    const response = await fetch(url, {
      headers: {
        'x-api-key': API_KEY,
      },
    });

    if (!response.ok) {
      console.error(`API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const json = await response.json();

    // Debug log for API response structure
    // console.log("API response:", json);

    if (json.data && Array.isArray(json.data)) {
      return {
        patients: json.data,
        pagination: json.pagination,
      };
    } else {
      console.error('Unexpected API response format:', json);
      return null;
    }
  } catch (error) {
    console.error('Fetch error:', error);
    return null;
  }
}

// Helper functions to parse risk scores from data
function parseBloodPressure(bpString) {
  if (!bpString || typeof bpString !== 'string') return null;
  const parts = bpString.split('/');
  if (parts.length !== 2) return null;

  const systolic = parseInt(parts[0], 10);
  const diastolic = parseInt(parts[1], 10);
  if (isNaN(systolic) || isNaN(diastolic)) return null;

  return { systolic, diastolic };
}

function bloodPressureRisk(bp) {
  if (!bp) return 0;
  const { systolic, diastolic } = bp;

  // Check for invalid readings
  if (systolic == null || diastolic == null) return 0;

  if (systolic < 120 && diastolic < 80) return 1; // Normal
  if (systolic >= 120 && systolic <= 129 && diastolic < 80) return 2; // Elevated
  if ((systolic >= 130 && systolic <= 139) || (diastolic >= 80 && diastolic <= 89))
    return 3; // Stage 1
  if (systolic >= 140 || diastolic >= 90) return 4; // Stage 2

  return 0; // default fallback
}

function temperatureRisk(temp) {
  if (temp == null || isNaN(temp)) return 0;
  if (temp <= 99.5) return 0; // Normal
  if (temp >= 99.6 && temp <= 100.9) return 1; // Low fever
  if (temp >= 101) return 2; // High fever
  return 0;
}

function ageRisk(age) {
  if (age == null || isNaN(age)) return 0;
  if (age < 40) return 1;
  if (age <= 65) return 1;
  if (age > 65) return 2;
  return 0;
}

function isValidNumber(value) {
  return value !== null && value !== undefined && !isNaN(value);
}

async function main() {
  console.log('Fetching patient data...');

  let allPatients = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await fetchPatients(page, 20);
    if (!result) {
      console.error('Failed to fetch patients, stopping.');
      break;
    }
    allPatients = allPatients.concat(result.patients);
    totalPages = result.pagination.totalPages;
    page++;
  } while (page <= totalPages);

  // Arrays to collect patient IDs for each alert category
  const highRiskPatients = [];
  const feverPatients = [];
  const dataQualityIssues = [];

  for (const patient of allPatients) {
    const bp = parseBloodPressure(patient.blood_pressure);
    const bpScore = bloodPressureRisk(bp);

    const temp = isValidNumber(patient.temperature) ? Number(patient.temperature) : null;
    const tempScore = temperatureRisk(temp);

    const age = isValidNumber(patient.age) ? Number(patient.age) : null;
    const ageScore = ageRisk(age);

    const totalRisk = bpScore + tempScore + ageScore;

    // Check data quality issues:
    const hasBadBP = !bp;
    const hasBadTemp = temp === null;
    const hasBadAge = age === null;

    if (hasBadBP || hasBadTemp || hasBadAge) {
      dataQualityIssues.push(patient.patient_id);
    }

    if (totalRisk >= 4) {
      highRiskPatients.push(patient.patient_id);
    }

    if (temp !== null && temp >= 99.6) {
      feverPatients.push(patient.patient_id);
    }
  }

  // Prepare results for submission
  const results = {
    high_risk_patients: [...new Set(highRiskPatients)],
    fever_patients: [...new Set(feverPatients)],
    data_quality_issues: [...new Set(dataQualityIssues)],
  };

  console.log('Submitting results to API...');
  try {
    const submitResponse = await fetch(`${BASE_URL}/submit-assessment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify(results),
    });

    const submitJson = await submitResponse.json();

    console.log('Submission response:', submitJson);
  } catch (err) {
    console.error('Error submitting results:', err);
  }
}

main();
