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

import { fixtureEntity, fixtureHealth } from '../../testUtils/fixtures';
import { buildGradeImageRows } from './GradeSectionTable';

describe('buildGradeImageRows', () => {
  it('builds and sorts table rows from grade image occurrences', () => {
    const repository = fixtureEntity('repository');
    const image = fixtureHealth(repository).snapshot!.images[0];
    const scheduledDrops = [
      { from: 'A', to: 'B', at: '2027-03-01T00:00:00.000Z' },
    ] as const;
    const sectionImages = [
      {
        repository,
        image: {
          ...image,
          imageId: 'image-2',
          architecture: 'arm64',
          futureDrops: scheduledDrops,
        },
      },
      {
        repository,
        image: { ...image, imageId: 'image-1', architecture: 'amd64' },
      },
    ];

    const rows = buildGradeImageRows(sectionImages);

    expect(rows.map(row => row.imageId)).toEqual(['image-1', 'image-2']);
    expect(rows[0]).toMatchObject({
      imageId: 'image-1',
      repositoryName: 'portfolio/repository-1',
    });
    expect(rows[1].futureDrops).toEqual(scheduledDrops);
  });
});
