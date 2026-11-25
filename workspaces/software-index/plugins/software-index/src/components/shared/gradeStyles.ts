/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type GradeTone = 'success' | 'warning' | 'danger';

export function gradeToneForId(gradeId: string): GradeTone {
  if (gradeId === 'a') {
    return 'success';
  }
  if (gradeId === 'a-with-drop' || gradeId === 'b' || gradeId === 'c') {
    return 'warning';
  }
  return 'danger';
}

export function gradeCellStyle(tone: GradeTone) {
  return {
    backgroundColor: `var(--bui-bg-${tone})`,
    color: `var(--bui-fg-${tone}-on-bg)`,
  };
}
