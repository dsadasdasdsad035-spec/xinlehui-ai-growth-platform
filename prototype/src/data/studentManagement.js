const STORAGE_KEY = 'xinlehui-student-management-v1';

export const seedStudents = [
  { name: '陈一诺', birthDate: '2019-04-18', className: '周六创意绘画 2 班', guardianName: '陈一诺妈妈', guardianPhone: '13800000000', expect: '希望孩子更自信地表达自己的想法。' },
  { name: '林小满', birthDate: '2018-08-12', className: '周六创意绘画 2 班', guardianName: '', guardianPhone: '', expect: '' },
  { name: '赵禾', birthDate: '2019-02-06', className: '周六创意绘画 2 班', guardianName: '', guardianPhone: '', expect: '' }
];

export const seedClasses = [
  { id: 'class-sat-2', name: '周六创意绘画 2 班', course: '创意绘画', schedule: '每周六 10:00–11:30', teacher: '林晓老师', capacity: 18 },
  { id: 'class-color', name: '色彩启蒙班', course: '色彩启蒙', schedule: '每周日 14:00–15:30', teacher: '林晓老师', capacity: 12 }
];

const safeParse = value => { try { return JSON.parse(value); } catch { return null; } };

export function loadStudentManagement() {
  if (typeof window === 'undefined') return { students: seedStudents, classes: seedClasses };
  const saved = safeParse(window.localStorage.getItem(STORAGE_KEY));
  if (!saved || !Array.isArray(saved.students) || !Array.isArray(saved.classes)) return { students: seedStudents, classes: seedClasses };
  return { students: saved.students, classes: saved.classes };
}

export function persistStudentManagement(students, classes) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ students, classes }));
}
