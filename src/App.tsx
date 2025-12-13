import { AgGridReact, CustomInnerHeaderGroupProps } from 'ag-grid-react';
import { useEffect, useRef, useState } from 'react';
import {
  AllCommunityModule,
  ColGroupDef,
  Column,
  ColumnGroup,
  ColumnHeaderClickedEvent,
  GridApi,
  ModuleRegistry,
  type ColDef,
} from 'ag-grid-community';
import { FindModule } from 'ag-grid-enterprise';
import './App.scss';
ModuleRegistry.registerModules([AllCommunityModule, FindModule]);

interface HeaderInfo {
  node: Column | ColumnGroup;
  id: string; // colId or groupId
  kind: 'col' | 'group';
  depthStart: number; // 헤더 row depth (0,1,2,...)
  depthEnd: number; // 헤더 row depth (0,1,2,...)
  leafStart: number; // 이 헤더가 커버하는 leaf index 시작
  leafEnd: number; // 이 헤더가 커버하는 leaf index 끝
  uniqueId: string;
}

interface SelectInfo {
  id: string;
  uniqueId: string;
}

interface HeaderModel {
  headers: HeaderInfo[];
  minDepth: number;
  maxDepth: number;
}

const findSameRowModel = (model: HeaderInfo[], a: HeaderInfo, b: HeaderInfo) => {
  const isSameDepth = a.depthStart === b.depthStart && a.depthEnd === b.depthEnd;
  if (!isSameDepth) return null;
  const findIdxA = model.findIndex(header => header.uniqueId === a.uniqueId);
  const findIdxB = model.findIndex(header => header.uniqueId === b.uniqueId);
  const filterInRangeModel = model.slice(Math.min(findIdxA, findIdxB), Math.max(findIdxA, findIdxB) + 1);
  const crossedModels = filterInRangeModel.filter(
    header => Math.max(a.depthStart, header.depthStart) <= Math.min(a.depthEnd, header.depthEnd)
  );

  // 겹치는 구간 중에 넘치는 구간을 가진 column이 있는 지 확인
  const hasTouchedModel = crossedModels.some(h => h.depthStart < a.depthStart || h.depthEnd > a.depthEnd);
  if (hasTouchedModel) return null;

  // 없다면 return true
  return new Set(crossedModels.map(header => header.id));
};

const buildHeaderModelFromGroups = (columnApi: GridApi): HeaderModel => {
  const roots = columnApi.getAllDisplayedColumnGroups() as (Column | ColumnGroup)[];
  const headers: HeaderInfo[] = [];
  let leafCounter = 0;
  let globalMaxDepth = 0;
  let globalMinDepth = Infinity;

  const processNode = (
    node: Column | ColumnGroup,
    depth: number
  ): { start: number; end: number; maxDepth: number } | null => {
    const anyNode = node as any;

    // leaf column
    if (anyNode.isColumn) {
      const col = node as Column;
      const idx = leafCounter++;

      const info: HeaderInfo = {
        node: col,
        id: col.getColId(),
        kind: 'col',
        depthStart: depth,
        depthEnd: depth,
        leafStart: idx,
        leafEnd: idx,
        uniqueId: col.getUniqueId(),
      };

      headers.push(info);
      globalMaxDepth = Math.max(globalMaxDepth, depth);
      globalMinDepth = Math.min(globalMinDepth, depth);
      return { start: idx, end: idx, maxDepth: depth };
    }

    // group
    const group = node as ColumnGroup;

    // padding group → 자기 자신은 만들지 않고 children만 처리
    if (group.isPadding()) {
      const children = group.getChildren?.() as (Column | ColumnGroup)[] | null;
      if (!children) return null;

      let min = Infinity;
      let max = -Infinity;
      let maxDepthInSubtree = depth;
      let has = false;

      children.forEach(child => {
        const span = processNode(child, depth);
        if (span) {
          has = true;
          min = Math.min(min, span.start);
          max = Math.max(max, span.end);
          maxDepthInSubtree = Math.max(maxDepthInSubtree, span.maxDepth);
        }
      });

      if (!has) return null;
      return { start: min, end: max, maxDepth: maxDepthInSubtree };
    }

    // 실제 group
    const children = group.getChildren?.() as (Column | ColumnGroup)[] | null;
    if (!children) return null;

    const idxInHeaders = headers.length;

    const placeholder: HeaderInfo = {
      node: group,
      id: group.getGroupId(),
      kind: 'group',
      depthStart: depth,
      depthEnd: depth, // 나중에 보정
      leafStart: 0,
      leafEnd: 0,
      uniqueId: group.getUniqueId(),
    };

    headers.push(placeholder);

    let min = Infinity;
    let max = -Infinity;
    let maxDepthInSubtree = depth;
    let has = false;

    children.forEach(child => {
      const span = processNode(child, depth + 1);
      if (span) {
        has = true;
        min = Math.min(min, span.start);
        max = Math.max(max, span.end);
        maxDepthInSubtree = Math.max(maxDepthInSubtree, span.maxDepth);
      }
    });

    if (!has) {
      headers.splice(idxInHeaders, 1);
      return null;
    }

    headers[idxInHeaders].leafStart = min;
    headers[idxInHeaders].leafEnd = max;
    headers[idxInHeaders].depthEnd = maxDepthInSubtree;

    globalMaxDepth = Math.max(globalMaxDepth, maxDepthInSubtree);
    globalMinDepth = Math.min(globalMinDepth, depth);

    return { start: min, end: max, maxDepth: maxDepthInSubtree };
  };

  const normalizeDepthEnd = () => {
    // globalMaxDepth 는 processNode 안에서 leaf 기준으로 이미 계산됨
    headers.forEach(h => {
      if (h.kind === 'col') {
        // leaf 컬럼은 자기 depth부터 마지막 행까지 rowSpan
        h.depthEnd = globalMaxDepth;
      } else {
        // group 헤더는 한 행만 사용
        h.depthEnd = h.depthStart;
      }
    });
  };

  roots?.forEach(root => processNode(root, 0));

  // 🔥 여기서 depthEnd 정규화
  normalizeDepthEnd();

  // (선택) 필요하다면 rowSpan 보정 로직을 여기서 추가해도 되고,
  // 지금처럼 논리 depth 그대로 두셔도 됩니다.
  if (!Number.isFinite(globalMinDepth)) globalMinDepth = 0;

  return {
    headers,
    minDepth: globalMinDepth,
    maxDepth: globalMaxDepth,
  };
};

// info 의 "조상"들
const getAncestors = (model: HeaderInfo[], info: HeaderInfo): HeaderInfo[] =>
  model.filter(h => h.depthStart < info.depthStart && h.leafStart <= info.leafStart && h.leafEnd >= info.leafEnd);

// info 아래에 더 깊은 자식이 있는지
const hasDeeperDescendant = (model: HeaderInfo[], info: HeaderInfo) =>
  model.some(h => h.depthStart > info.depthStart && h.leafStart >= info.leafStart && h.leafEnd <= info.leafEnd);

// "full-depth 헤더" : 맨 위 행(minDepth)에 있으면서 자기 아래 더 깊은 자식이 없는 헤더
const isFullDepthHeader = (model: HeaderInfo[], h: HeaderInfo, minDepth: number) =>
  h.depthStart === minDepth && !hasDeeperDescendant(model, h);

const getHeaderInfo = (model: HeaderInfo[], id: string, uniqueId: string): HeaderInfo | null =>
  model.find(info => info.id === id && info.uniqueId === uniqueId) ?? null;

const computeSelectionFromGroups = (
  model: HeaderInfo[],
  minDepth: number,
  maxDepth: number,
  anchor: SelectInfo,
  target: SelectInfo
): { selectedIds: string[] } => {
  const infoA = getHeaderInfo(model, anchor.id, anchor.uniqueId);
  const infoB = getHeaderInfo(model, target.id, target.uniqueId);
  if (!infoA || !infoB) return { selectedIds: [] };

  // 같은 행에 있는 경우
  const sameRowModel = findSameRowModel(model, infoA, infoB);
  if (sameRowModel) {
    return { selectedIds: Array.from(sameRowModel) };
  }

  // 엑셀 스타일: 두 클릭 지점 사이의 사각형 영역 정의
  // 초기 사각형: 두 클릭 지점의 leaf 범위와 depth 범위
  let rectLeafStart = Math.min(infoA.leafStart, infoB.leafStart);
  let rectLeafEnd = Math.max(infoA.leafEnd, infoB.leafEnd);
  let rectDepthStart = Math.min(infoA.depthStart, infoB.depthStart);
  let rectDepthEnd = Math.max(infoA.depthEnd, infoB.depthEnd);

  // 반복적으로 경계에서 잘리는 헤더가 없도록 영역 확장
  let changed = true;
  while (changed) {
    changed = false;

    for (const h of model) {
      // 수평 겹침이 없으면 무시
      if (h.leafEnd < rectLeafStart || h.leafStart > rectLeafEnd) continue;

      // 이 헤더가 현재 사각형과 겹치면서 경계를 넘어가면(잘라진다면) 영역 확장
      const overlapsHorizontally = h.leafStart <= rectLeafEnd && h.leafEnd >= rectLeafStart;
      const overlapsVertically = h.depthStart <= rectDepthEnd && h.depthEnd >= rectDepthStart;

      if (overlapsHorizontally && overlapsVertically) {
        // 헤더가 사각형 경계를 넘어가면 영역 확장
        const needsExpansion =
          h.leafStart < rectLeafStart ||
          h.leafEnd > rectLeafEnd ||
          h.depthStart < rectDepthStart ||
          h.depthEnd > rectDepthEnd;

        if (needsExpansion) {
          const newLeafStart = Math.min(rectLeafStart, h.leafStart);
          const newLeafEnd = Math.max(rectLeafEnd, h.leafEnd);
          const newDepthStart = Math.min(rectDepthStart, h.depthStart);
          const newDepthEnd = Math.max(rectDepthEnd, h.depthEnd);

          if (
            newLeafStart !== rectLeafStart ||
            newLeafEnd !== rectLeafEnd ||
            newDepthStart !== rectDepthStart ||
            newDepthEnd !== rectDepthEnd
          ) {
            rectLeafStart = newLeafStart;
            rectLeafEnd = newLeafEnd;
            rectDepthStart = newDepthStart;
            rectDepthEnd = newDepthEnd;
            changed = true;
          }
        }
      }
    }
  }

  // 사각형 영역과 겹치는 모든 헤더 찾기
  const overlappingHeaders: HeaderInfo[] = [];
  for (const h of model) {
    const overlapsHorizontally = h.leafStart <= rectLeafEnd && h.leafEnd >= rectLeafStart;
    const overlapsVertically = h.depthStart <= rectDepthEnd && h.depthEnd >= rectDepthStart;

    if (overlapsHorizontally && overlapsVertically) {
      overlappingHeaders.push(h);
    }
  }

  // 엑셀 로직: 상위 헤더가 이미 완전히 포함되어 있으면 제외
  // (하위 헤더들이 이미 선택되므로 상위 헤더는 중복 선택 불필요)
  const selectedHeaders: HeaderInfo[] = [];

  for (const h of overlappingHeaders) {
    // 이 헤더가 다른 선택된 헤더에 완전히 포함되어 있는지 확인
    const isFullyContained = overlappingHeaders.some(other => {
      if (other.id === h.id) return false;
      // other가 h의 조상이고 h를 완전히 포함하는지
      return (
        other.depthStart < h.depthStart &&
        other.depthEnd >= h.depthEnd &&
        other.leafStart <= h.leafStart &&
        other.leafEnd >= h.leafEnd
      );
    });

    // 완전히 포함되지 않은 헤더만 선택
    if (!isFullyContained) {
      selectedHeaders.push(h);
    }
  }

  // 최종 선택된 ID들
  const selectedIds = selectedHeaders.map(h => h.id);

  return { selectedIds };
};

interface CustomHeaderComponentProps extends CustomInnerHeaderGroupProps {
  onColumnHeaderClicked: (params: CustomHeaderComponentProps) => void;
}

const CustomHeaderComponent = (props: CustomHeaderComponentProps) => {
  const { displayName, eGridHeader, onColumnHeaderClicked: _onColumnHeaderClicked } = props;
  const onColumnHeaderClicked = (event: MouseEvent) => {
    event.stopPropagation();
    _onColumnHeaderClicked(props);
  };
  useEffect(() => {
    eGridHeader.addEventListener('click', onColumnHeaderClicked, { capture: true, passive: true });

    return () => {
      eGridHeader.addEventListener('click', onColumnHeaderClicked, { capture: true, passive: true });
    };
  }, []);

  return <>{displayName}</>;
};

function App() {
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const lastClickedIdRef = useRef<SelectInfo | null>(null);
  const [pressShift, setPressShift] = useState<boolean>(false);
  const [colDefs, setColDefs] = useState<(ColDef<any, any> | ColGroupDef<any>)[]>([
    {
      // [그룹] A1
      headerName: 'A1',
      colId: 'A1',
      marryChildren: true,
      children: [
        {
          headerName: 'A1-2',
          field: 'a2',
          colId: 'A1_2',
        },
        {
          headerName: 'A1-3',
          field: 'a3',
          colId: 'A1_3',
          marryChildren: true,
        },
        {
          headerName: 'A1-1',
          field: 'a1',
          children: [
            {
              headerName: 'A1-1-1',
              field: 'a13',
              // pinned: 'left',
            },
            {
              headerName: 'A1-1-2',
              field: 'a14',
              colId: 'A1_1_2',
            },
          ],
        },
      ],
    },
    {
      headerName: 'A2',
      field: 'a4',
      colId: 'A2',
      groupId: 'A2',
      children: [
        {
          headerName: 'A2-1',
          field: 'a2-1',
          colId: 'A2_1',
          groupId: 'A2_1',
          children: [
            {
              headerName: 'A2-1-1',
              field: 'a2-1-1',
              colId: 'a2_1_1',
              children: [
                {
                  headerName: 'A2-1-1-1',
                  field: 'a2-1-1-1',
                  colId: 'a2_1-1-1',
                  children: [
                    {
                      headerName: 'A2-1-1-1-1',
                      field: 'a2-1-1-1-1',
                      colId: 'a2_1-1-1-1',
                    },
                  ],
                },
              ],
            },
            {
              headerName: 'A2-1-2',
              field: 'a2-1-2',
              colId: 'a2_1_2',
              children: [
                {
                  headerName: 'A2-1-2-1',
                  field: 'a2-1-2-1',
                  colId: 'a2_1-2-1',
                  children: [
                    {
                      headerName: 'A2-1-2-1-1',
                      field: 'a2-1-2-1-1',
                      colId: 'a2_1-2-1-1',
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          headerName: 'A2-2',
          field: 'a2-1',
          colId: 'a2_2',
          groupId: 'a2_2',
          children: [
            {
              headerName: 'A2-2-1',
              field: 'a2-2-1',
              colId: 'a2_2_1',
              children: [
                {
                  headerName: 'A2-2-1-1',
                  field: 'a2-2-1-1',
                  colId: 'a2_2_1-1',
                  children: [
                    {
                      headerName: 'A2-2-1-1-1',
                      field: 'a2-2-1-1-1',
                      colId: 'a2_2_1-1-1',
                    },
                  ],
                },
              ],
            },
            {
              headerName: 'A2-2-2',
              field: 'a2-2-2',
              colId: 'a2_2_2',
              children: [
                {
                  headerName: 'A2-2-2-1',
                  field: 'a2-2-2-1',
                  colId: 'a2_2_2-1',
                  children: [
                    {
                      headerName: 'A2-2-2-1-1',
                      field: 'a2-2-2-1-1',
                      colId: 'a2_2_2-1-1',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      headerName: 'A3',
      field: 'a5',
      colId: 'A3',
    },
    {
      headerName: 'A4',
      colId: 'A4',
      groupId: 'A4',
      marryChildren: true,
      children: [
        {
          headerName: 'A4-1',
          field: 'a7',
          colId: 'A4_1',
        },
        {
          headerName: 'A4-2',
          field: 'a8',
          colId: 'A4_2',
        },
        {
          headerName: 'A4-3',
          field: 'a9',
          colId: 'A4_3',
        },
        {
          headerName: 'A4-4',
          field: 'a10',
          colId: 'A4_4',
        },
        {
          headerName: 'A4-5',
          field: 'a11',
          colId: 'A4_5',
        },
        {
          headerName: 'A4-6',
          field: 'a12',
          colId: 'A4_6',
          // pinned: 'left',
        },
      ],
    },
  ]);

  const onColumnHeaderClicked = (params: ColumnHeaderClickedEvent | CustomHeaderComponentProps) => {
    // Column | ProvidedColumnGroup 둘 다 여기로 들어옴

    let uniqueId: string;
    let id: string;
    if ('eGridHeader' in params) {
      uniqueId = params.columnGroup.getUniqueId();
      id = params.columnGroup.getGroupId();
    } else if (params.column.isColumn) {
      uniqueId = params.column.getUniqueId();
      id = params.column.getColId();
    } else {
      return;
    }

    // ✅ getAllDisplayedColumnGroups 기반 최신 뷰 모델
    const { headers, minDepth, maxDepth } = buildHeaderModelFromGroups(params.api);

    setSelectedCols(prev => {
      if (pressShift && lastClickedIdRef.current) {
        const { selectedIds } = computeSelectionFromGroups(headers, minDepth, maxDepth, lastClickedIdRef.current, {
          id,
          uniqueId,
        });
        lastClickedIdRef.current = { id, uniqueId };
        return selectedIds;
      }

      // 그냥 클릭이면 단일 선택
      lastClickedIdRef.current = { id, uniqueId };
      return [id];
    });
  };

  useEffect(() => {
    const pressShiftHandler = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setPressShift(true);
      }
    };

    const keyupHandler = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setPressShift(false);
      }
    };

    window.addEventListener('keydown', pressShiftHandler);
    window.addEventListener('keyup', keyupHandler);

    return () => {
      window.removeEventListener('keydown', pressShiftHandler);
      window.removeEventListener('keyup', keyupHandler);
    };
  }, []);

  const headerClass: ColDef['headerClass'] = params => {
    const group = params.columnGroup;
    const col = params.column;

    if (group) {
      const gid = typeof group.getGroupId === 'function' ? group.getGroupId() : '';
      return selectedCols.includes(gid) ? 'excel-header-selected' : '';
    }

    if (col) {
      const cid = typeof col.getColId === 'function' ? col.getColId() : '';
      return selectedCols.includes(cid) ? 'excel-header-selected' : '';
    }

    return '';
  };

  return (
    <div style={{ height: 500 }}>
      <AgGridReact
        defaultColDef={{
          headerComponentParams: {},
          sortable: false,
          headerClass,
        }}
        onColumnMoved={e => {
          setColDefs(e.api.getColumnDefs() ?? []);
        }}
        defaultColGroupDef={{
          headerGroupComponentParams: {
            innerHeaderGroupComponent: CustomHeaderComponent,
            innerHeaderGroupComponentParams: {
              onColumnHeaderClicked,
            },
          },
          headerClass,
        }}
        onColumnHeaderClicked={onColumnHeaderClicked}
        columnDefs={colDefs}
        loading={false}
      />
    </div>
  );
}

export default App;
