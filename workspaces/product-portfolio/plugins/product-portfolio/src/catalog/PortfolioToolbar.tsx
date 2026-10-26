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

import {
  Box,
  Button,
  Card,
  CardBody,
  Flex,
  Grid,
  Text,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from '@backstage/ui';

export interface PortfolioKindOption {
  id: string;
  label: string;
  count: number;
}

interface PortfolioToolbarProps {
  options: PortfolioKindOption[];
  selectedKind: string;
  query: string;
  currentCount: number;
  totalCount: number;
  loading: boolean;
  hasActiveFilters: boolean;
  onKindChange: (kind: string) => void;
  onQueryChange: (query: string) => void;
  onClearFilters: () => void;
}

export function PortfolioToolbar({
  options,
  selectedKind,
  query,
  currentCount,
  totalCount,
  loading,
  hasActiveFilters,
  onKindChange,
  onQueryChange,
  onClearFilters,
}: PortfolioToolbarProps) {
  const selectedLabel =
    options
      .find(option => option.id === selectedKind)
      ?.label.toLocaleLowerCase('en-US') ?? 'entries';
  const resultSummary = loading
    ? `Loading ${selectedLabel}…`
    : `Showing ${currentCount} of ${totalCount} ${selectedLabel}`;

  return (
    <Card role="search" aria-label="Product portfolio search">
      <CardBody>
        <Grid.Root columns={{ initial: '1', md: '2' }} gap="4">
          <Grid.Item>
            <Flex direction="column" gap="2">
              <Text as="div" variant="body-small" weight="bold">
                Kind
              </Text>
              <ToggleButtonGroup
                aria-label="Filter by entity type"
                selectionMode="single"
                selectedKeys={[selectedKind]}
                onSelectionChange={selection => {
                  const [kind] = Array.from(selection);
                  if (typeof kind === 'string') {
                    onKindChange(kind);
                  }
                }}
              >
                {options.map(option => (
                  <ToggleButton key={option.id} id={option.id} size="small">
                    <Flex
                      align="center"
                      justify="between"
                      gap="2"
                      style={{ width: '100%' }}
                    >
                      <Text as="div" variant="body-small">
                        {option.label}
                      </Text>
                      <Text as="div" variant="body-small" color="secondary">
                        {option.count}
                      </Text>
                    </Flex>
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Flex>
          </Grid.Item>

          <Grid.Item>
            <Flex align="end" gap="2">
              <Box width="100%" minWidth="0">
                <TextField
                  label="Search by name"
                  placeholder={`Search ${selectedLabel}`}
                  value={query}
                  onChange={onQueryChange}
                  size="small"
                />
              </Box>
              {hasActiveFilters && (
                <Button onPress={onClearFilters} size="small">
                  Clear filters
                </Button>
              )}
            </Flex>
          </Grid.Item>

          <Grid.Item colSpan={{ md: '2' }}>
            <Text as="p" variant="body-small" color="secondary" role="status">
              {resultSummary}
            </Text>
          </Grid.Item>
        </Grid.Root>
      </CardBody>
    </Card>
  );
}
