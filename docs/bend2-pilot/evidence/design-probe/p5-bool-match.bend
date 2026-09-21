import Base

law pick:
  for b: Bool
  U32

def pick(b):
  match b:
    case True{}:
      1
    case False{}:
      0

law main:
  U32

def main(): pick(True{})
